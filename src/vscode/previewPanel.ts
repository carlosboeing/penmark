import * as path from "path";
import * as vscode from "vscode";
import type {
  ContentWidth,
  HighlightIntensity,
  HostToWebview,
  PreviewSettingKey,
  PreviewSettingValue,
  PreviewSettingsState,
  ThemeMode,
} from "../core/protocol/messages.js";
import { resolveTypography, type PresetName, type TextSize, type TypographySettings } from "../core/settings/typography.js";
import { buildShellHtml, generateNonce } from "./html.js";
import { loadHighlighterIfNeeded } from "./hljsLoader.js";
import {
  analyzeComments,
  nowTimestamp,
  offsetEditsToWorkspaceEdit,
  planAddComment,
  planResolveComment,
  planEditComment,
  resolveAuthor,
} from "./comments.js";
import { buildReviewPrompt } from "../core/comments/exportPrompt.js";
import { logReconcileCorruption } from "./outputChannel.js";

// The markdown-it render stack (src/vscode/render.ts → markdown-it + plugins) is
// LAZY-loaded so it is NOT evaluated at activation — keeping activate() within
// the <50 ms budget (design §8). esbuild marks "./render.js" external and emits
// it as a separate node bundle; the first render pays the one-time module eval
// (well within the 300 ms first-render budget), every later render reuses it.
// comments.ts is imported statically — it depends only on lightweight core
// modules (no markdown-it), so it costs nothing at activation; it reaches the
// block tokenizer through this same lazy render module.
let _renderModule: typeof import("./render.js") | undefined;
async function getRenderModule(): Promise<typeof import("./render.js")> {
  _renderModule ??= await import("./render.js");
  return _renderModule;
}
async function getRenderDocument(): Promise<(typeof import("./render.js"))["renderDocument"]> {
  return (await getRenderModule()).renderDocument;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

export interface PanelEntry {
  panel: vscode.WebviewPanel;
  /** Column the panel lives in — used for singleton-per-column keying. */
  column: vscode.ViewColumn;
  /** Shell HTML most recently set on this panel. */
  html: string;
  /** Whether retainContextWhenHidden was enabled (always false; recorded for tests). */
  retainContext: boolean;
  /** Number of `render` messages posted by this panel instance (reset via seam). */
  renderCount: number;
  /** Last render message payload sent, for test assertions. */
  lastRenderMessage: Extract<HostToWebview, { type: "render" }> | undefined;
  /** Last setTheme message payload sent (from config change), for test assertions. */
  lastSetThemeMessage: Extract<HostToWebview, { type: "setTheme" }> | undefined;
  /** The source document currently being previewed in this panel. */
  document: vscode.TextDocument | undefined;
  /** Last `revealLine` message posted to this panel, for test assertions. */
  lastRevealLineMessage: Extract<HostToWebview, { type: "revealLine" }> | undefined;
  /**
   * Timestamp (Date.now()) until which editor visible-range changes are ignored
   * as echoes of our own `revealRange`. The host half of the two-sided 100 ms
   * echo-suppression window that breaks the editor↔preview feedback loop (T10).
   */
  suppressVisibleRangeUntil: number;
  /** Last time a `revealLine` was posted to this panel, for throttling. */
  lastRevealLinePostedAt: number;
  /**
   * Serialization chain for document-mutating comment ops (add/resolve). Each op
   * reads the live document text and applies a WorkspaceEdit; running two at once
   * would let the second plan against pre-first-edit text and apply stale offsets
   * onto the already-mutated document (silent corruption). Chaining guarantees one
   * mutation fully lands before the next reads the document. Undefined until the
   * first mutation; see {@link enqueueMutation}.
   */
  mutationChain?: Promise<void>;
  /**
   * The corruption signal-set last logged for this panel's document, e.g.
   * `"false|false"`. Used to log a reconcile corruption diagnostic only when the
   * state CHANGES, not on every (debounced) render — otherwise a persistently
   * corrupt document floods the output channel for the whole session (§9).
   */
  lastCorruptionKey?: string;
}

/** Active panels keyed by the ViewColumn they occupy. */
const panels = new Map<vscode.ViewColumn | string, PanelEntry>();

/** Accumulated render count across all panels, reset by the test seam. */
let _totalRenderCount = 0;

/** Debounce timer handles keyed by document URI. */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS = 300;

/** Echo-suppression window for scroll sync — must match the webview's (T10). */
const SCROLL_ECHO_SUPPRESS_MS = 100;

/** Throttle interval for posting `revealLine` as the editor scrolls (T10). */
const REVEAL_LINE_THROTTLE_MS = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The user's configured preview theme (penmark.theme). This is the SETTING
 * (light/dark/auto) — NOT the IDE's active theme. The webview resolves `auto`
 * against the IDE body class and installs a live observer; `light`/`dark`
 * override the IDE regardless (T6, design §6). Sending the IDE theme here would
 * defeat both auto-follow and the override, so the host always sends the setting.
 */
function configuredTheme(): ThemeMode {
  return vscode.workspace.getConfiguration("penmark").get<ThemeMode>("theme", "auto");
}

/**
 * Whether Mermaid rendering is enabled (penmark.mermaid.enabled, default true).
 * When false the host renders ```mermaid fences as plain code blocks, so the
 * webview finds no .pmk-mermaid containers and never loads the mermaid chunk.
 */
function configuredMermaidEnabled(): boolean {
  return vscode.workspace.getConfiguration("penmark").get<boolean>("mermaid.enabled", true);
}

/**
 * Whether bidirectional scroll sync is enabled (penmark.scrollSync, default
 * true). When false BOTH directions go silent — the host posts no `revealLine`
 * and ignores incoming `scrolled` messages (T10).
 */
function configuredScrollSync(): boolean {
  return vscode.workspace.getConfiguration("penmark").get<boolean>("scrollSync", true);
}

/**
 * Configured preview content width (penmark.contentWidth, default "full"). All
 * presets are responsive (max-width caps); applied as a `pmk-content-*` body
 * class on the shell and live-updated via `setContentWidth` (see html.ts +
 * media/penmark.css).
 */
function configuredContentWidth(): ContentWidth {
  return vscode.workspace.getConfiguration("penmark").get<ContentWidth>("contentWidth", "full");
}

/**
 * Configured comment highlight intensity (penmark.comments.highlightIntensity,
 * default "medium"). Applied as a `pmk-hl-*` body class on the shell at panel
 * (re)creation; comments are always highlighted (never "off", design §6).
 */
function configuredHighlightIntensity(): HighlightIntensity {
  return vscode.workspace
    .getConfiguration("penmark")
    .get<HighlightIntensity>("comments.highlightIntensity", "medium");
}

const VALID_SETTING_VALUES = {
  theme: ["light", "dark", "auto"],
  preset: ["github", "reading", "compact", "focus", "print", "custom"],
  textSize: ["small", "medium", "large", "x-large"],
  contentWidth: ["comfortable", "wide", "full"],
  "comments.highlightIntensity": ["subtle", "medium", "strong"],
} as const;

function isStringSettingValue(key: PreviewSettingKey, value: PreviewSettingValue): boolean {
  if (key === "lineHeight") return false;
  return (
    typeof value === "string" &&
    (VALID_SETTING_VALUES[key] as readonly string[]).includes(value)
  );
}

function isLineHeightValue(value: PreviewSettingValue): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 2.5;
}

export async function handleUpdateSetting(
  key: PreviewSettingKey,
  value: PreviewSettingValue,
): Promise<void> {
  if (key === "lineHeight") {
    if (!isLineHeightValue(value)) return;
  } else if (!isStringSettingValue(key, value)) {
    return;
  }

  await vscode.workspace
    .getConfiguration("penmark")
    .update(key, value, vscode.ConfigurationTarget.Global);
}

/** Resolved typography from penmark.* settings (v1.0 polish). */
function configuredTypography(): TypographySettings {
  const settings = configuredPreviewSettings();
  return resolveTypography({
    ...settings,
    lineHeight: settings.lineHeight > 0 ? settings.lineHeight : undefined,
  });
}

function configuredPreviewSettings(): PreviewSettingsState {
  const cfg = vscode.workspace.getConfiguration("penmark");
  const lineHeight = cfg.get<number>("lineHeight", 0);
  return {
    theme: configuredTheme(),
    preset: cfg.get<PresetName>("preset", "github"),
    textSize: cfg.get<TextSize>("textSize", "medium"),
    contentWidth: configuredContentWidth(),
    highlightIntensity: configuredHighlightIntensity(),
    lineHeight,
  };
}

/**
 * Find the visible text editor showing `entry.document`, if any. Scroll sync is
 * a no-op when the source editor is not currently visible.
 */
function findEditorForEntry(entry: PanelEntry): vscode.TextEditor | undefined {
  if (!entry.document) return undefined;
  return vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === entry.document!.uri.toString(),
  );
}

/**
 * Post a `revealLine` to the panel for the given source line — IF scroll sync
 * is on and we are not inside the host echo-suppression window. Opens the
 * suppression window so the editor visible-range change this is responding to
 * (or any it triggers) is not bounced back. Throttled per panel.
 *
 * Exported as the testable seam for the layer-4 test: it exercises the exact
 * setting + suppression gating the real visible-range listener uses, without
 * depending on the test harness reliably firing onDidChangeTextEditorVisibleRanges.
 */
export function maybePostRevealLine(entry: PanelEntry, line: number): void {
  if (!configuredScrollSync()) return;
  const now = Date.now();
  if (now < entry.suppressVisibleRangeUntil) return;
  if (now - entry.lastRevealLinePostedAt < REVEAL_LINE_THROTTLE_MS) return;
  entry.lastRevealLinePostedAt = now;

  const msg: Extract<HostToWebview, { type: "revealLine" }> = {
    v: 1,
    type: "revealLine",
    line,
  };
  entry.lastRevealLineMessage = msg;
  void entry.panel.webview.postMessage(msg);
}

/**
 * Register an onDidChangeTextEditorVisibleRanges listener that posts `revealLine`
 * to `entry`'s panel when the editor showing `entry.document` scrolls. The
 * returned disposable MUST be disposed on panel close. Gated by penmark.scrollSync
 * and echo-suppressed via {@link maybePostRevealLine} (T10).
 */
function attachVisibleRangeListener(entry: PanelEntry): vscode.Disposable {
  return vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
    if (!entry.document || e.textEditor.document.uri.toString() !== entry.document.uri.toString()) return;
    const first = e.visibleRanges[0];
    if (!first) return;
    maybePostRevealLine(entry, first.start.line);
  });
}

/**
 * Register an onDidChangeConfiguration listener that pushes live updates to
 * `entry`'s panel: `setTheme` when `penmark.theme` changes, `setContentWidth`
 * when `penmark.contentWidth` changes. The returned disposable MUST be disposed
 * on panel close — otherwise it leaks and fires on a disposed webview.
 */
function attachConfigListener(entry: PanelEntry): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("penmark.theme")) {
      const msg: Extract<HostToWebview, { type: "setTheme" }> = {
        v: 1,
        type: "setTheme",
        theme: configuredTheme(),
      };
      entry.lastSetThemeMessage = msg;
      void entry.panel.webview.postMessage(msg);
    }
    if (e.affectsConfiguration("penmark.contentWidth")) {
      const msg: Extract<HostToWebview, { type: "setContentWidth" }> = {
        v: 1,
        type: "setContentWidth",
        contentWidth: configuredContentWidth(),
      };
      void entry.panel.webview.postMessage(msg);
    }
    if (
      e.affectsConfiguration("penmark.preset") ||
      e.affectsConfiguration("penmark.textSize") ||
      e.affectsConfiguration("penmark.fontFamily") ||
      e.affectsConfiguration("penmark.headingFontFamily") ||
      e.affectsConfiguration("penmark.lineHeight")
    ) {
      const msg: Extract<HostToWebview, { type: "setTypography" }> = {
        v: 1,
        type: "setTypography",
        typography: configuredTypography(),
      };
      void entry.panel.webview.postMessage(msg);
    }
  });
}

function docName(document: vscode.TextDocument): string {
  return path.basename(document.fileName);
}

/**
 * Write copied code-block text to the system clipboard (T8).
 *
 * Extracted so the layer-4 test can drive the host→clipboard round-trip
 * directly — driving a real webview button click from the extension host is
 * not feasible, so the Playwright test covers webview→host posting and this
 * covers host→clipboard.
 */
export async function handleCopyCode(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
}

/** Toggle a task-list checkbox on `line` via a single WorkspaceEdit (v1.0 polish). */
export async function handleToggleTaskCheckbox(
  document: vscode.TextDocument,
  line: number,
  checked: boolean,
): Promise<void> {
  const lineText = document.lineAt(line).text;
  const next = checked
    ? lineText.replace(/^(\s*[-*+]\s+)\[ \]/, "$1[x]")
    : lineText.replace(/^(\s*[-*+]\s+)\[[xX]\]/, "$1[ ]");
  if (next === lineText) return;
  const edit = new vscode.WorkspaceEdit();
  const range = document.lineAt(line).range;
  edit.replace(document.uri, range, next);
  await vscode.workspace.applyEdit(edit);
}

/**
 * Add a comment on a webview selection (R7). Reads the live document text, plans
 * the anchor + entry edits (resolve = the selected text becomes the advisory
 * quote; the host always writes `(human)`, D14), and applies them as ONE
 * WorkspaceEdit (one undo step, §7.1). The change listener re-renders. Surfaces
 * a discreet message when the selection cannot carry an anchor (§4.1).
 *
 * Exported so the layer-4 test (and Carlos's smoke) can drive the host add path
 * directly; a real webview selection cannot be synthesised from the host.
 */
export async function handleAddComment(
  document: vscode.TextDocument,
  range: { start: number; end: number },
  quote: string,
  body: string,
): Promise<void> {
  const source = document.getText();
  const { tokenizeBlockOffsets } = await getRenderModule();
  const plan = planAddComment({
    source,
    range,
    quote,
    body,
    author: resolveAuthor(),
    timestamp: nowTimestamp(),
    tokenize: tokenizeBlockOffsets,
  });
  if ("uncommentable" in plan) {
    void vscode.window.showInformationMessage(
      "Penmark: that selection can't carry a comment — try selecting prose, a whole block, or a range of blocks.",
    );
    return;
  }
  const edit = offsetEditsToWorkspaceEdit(document.uri, document, plan.edits);
  await vscode.workspace.applyEdit(edit);
  if (typeof document.save === "function") {
    await document.save();
  }
}

/**
 * Resolve (= delete, ADR 0002) the comment `id` as one WorkspaceEdit (R7). A
 * no-op when nothing matches. Exported for the layer-4 test / smoke.
 */
export async function handleResolveComment(
  document: vscode.TextDocument,
  id: string,
): Promise<void> {
  const edits = planResolveComment(document.getText(), id);
  if (edits.length === 0) return;
  const edit = offsetEditsToWorkspaceEdit(document.uri, document, edits);
  await vscode.workspace.applyEdit(edit);
  if (typeof document.save === "function") {
    await document.save();
  }
}

/**
 * Edit/update the body of the comment `id` as one WorkspaceEdit (R7). A
 * no-op when nothing matches.
 */
export async function handleEditComment(
  document: vscode.TextDocument,
  id: string,
  newBody: string,
): Promise<void> {
  const edits = planEditComment(document.getText(), id, newBody);
  if (!edits || edits.length === 0) return;
  const edit = offsetEditsToWorkspaceEdit(document.uri, document, edits);
  await vscode.workspace.applyEdit(edit);
  if (typeof document.save === "function") {
    await document.save();
  }
}

/**
 * Export the document's open review comments as an agent-ready prompt (R9), then
 * offer to copy it to the clipboard (default) or save it beside the document as
 * `<basename>.review.md`. Read-only on the source — Save writes a NEW file. A
 * document with no open comments still exports (a "No open comments." stub) so
 * the command is never silently inert.
 *
 * Exported for the host unit test and Carlos's smoke.
 */
export async function handleExportReview(document: vscode.TextDocument): Promise<void> {
  const analysis = analyzeComments(document.getText());
  const prompt = buildReviewPrompt(
    vscode.workspace.asRelativePath(document.uri),
    analysis.result.comments,
  );

  const COPY = "Copy to clipboard";
  const SAVE = "Save to file";
  const choice = await vscode.window.showQuickPick([COPY, SAVE], {
    placeHolder: "Export Penmark review as an agent-ready prompt",
  });
  if (choice === undefined) return; // dismissed

  if (choice === SAVE) {
    const dir = path.dirname(document.uri.fsPath);
    const base = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath));
    const target = vscode.Uri.file(path.join(dir, `${base}.review.md`));
    await vscode.workspace.fs.writeFile(target, Buffer.from(prompt, "utf8"));
    void vscode.window.showInformationMessage(
      `Penmark: review saved to ${vscode.workspace.asRelativePath(target)}`,
    );
    return;
  }

  await vscode.env.clipboard.writeText(prompt);
  void vscode.window.showInformationMessage("Penmark: review copied to clipboard");
}

/**
 * Run a document-mutating comment op serialized after any in-flight one on the
 * same panel, so each op reads a document the previous op has finished mutating
 * (no stale-offset corruption from overlapping add/resolve edits — §7.1). A
 * failed op is logged and does not break the chain for subsequent ops.
 *
 * Exported for the host unit test (the mechanism is the integrity guarantee).
 */
export function enqueueMutation(entry: PanelEntry, op: () => Promise<void>): void {
  entry.mutationChain = (entry.mutationChain ?? Promise.resolve())
    .then(op)
    .catch((err: unknown) => {
      console.error("Penmark: comment mutation failed", err);
    });
}

async function postRender(entry: PanelEntry, document: vscode.TextDocument): Promise<void> {
  // Track which document this panel is currently previewing so we can re-post
  // it when the webview signals `ready` (race-free handshake, T5).
  entry.document = document;

  const text = document.getText();
  // Lazily load highlight.js only when the document has a language-tagged fence
  // (D8). Prose-only documents never trigger the dynamic import.
  const highlight = await loadHighlighterIfNeeded(text);

  // Reconcile comments read-only on every render (R8): classify them, surface
  // the attention count + per-comment state to the webview, and log any
  // corruption signals to the output channel (no toast — design §9). This
  // applies no edits; opening a document never mutates it.
  const analysis = analyzeComments(text);
  // Log corruption only when the signal-set changes (not every render), so a
  // persistently corrupt document does not flood the channel session-long (§9).
  const corruptionKey = `${analysis.result.secondReviewBlock}|${analysis.result.reviewBlockMisplaced}`;
  if (corruptionKey !== entry.lastCorruptionKey) {
    logReconcileCorruption(docName(document), analysis.result);
    entry.lastCorruptionKey = corruptionKey;
  }

  const renderDocument = await getRenderDocument();
  const msg = renderDocument(
    text,
    document.uri,
    docName(document),
    configuredTheme(),
    entry.panel.webview,
    highlight,
    configuredMermaidEnabled(),
    analysis,
    configuredTypography(),
    configuredPreviewSettings(),
  );
  entry.lastRenderMessage = msg;
  entry.renderCount++;
  _totalRenderCount++;
  void entry.panel.webview.postMessage(msg);
}

function setupPanelEntry(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  document: vscode.TextDocument | undefined,
  key: vscode.ViewColumn | string,
): PanelEntry {
  const nonce = generateNonce();
  const scriptUri = vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "main.js");
  const html = buildShellHtml(
    panel.webview,
    nonce,
    scriptUri,
    context.extensionUri,
    configuredContentWidth(),
    configuredHighlightIntensity(),
  );
  panel.webview.html = html;

  const entry: PanelEntry = {
    panel,
    column: panel.viewColumn ?? vscode.ViewColumn.Beside,
    html,
    retainContext: false,
    renderCount: 0,
    lastRenderMessage: undefined,
    lastSetThemeMessage: undefined,
    document,
    lastRevealLineMessage: undefined,
    suppressVisibleRangeUntil: 0,
    lastRevealLinePostedAt: 0,
  };
  panels.set(key, entry);

  // Initial render
  if (document) {
    void postRender(entry, document);
  }

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage((msg: unknown) => {
    if (!msg || typeof msg !== "object") return;
    const message = msg as {
      v?: number;
      type?: string;
      href?: string;
      text?: string;
      topLine?: number;
      range?: { start?: number; end?: number };
      quote?: string;
      body?: string;
      id?: string;
      line?: number;
      checked?: boolean;
    };
    if (message.v !== 1) return;

    switch (message.type) {
      case "ready":
        // Webview has attached its listener — re-post the current render so the
        // initial postRender (which may have been dropped before the listener
        // was attached) is guaranteed to arrive.
        if (entry.document) {
          void postRender(entry, entry.document);
        }
        break;

      case "themeSelected": {
        const theme = (message as { v: number; type: string; theme?: string }).theme;
        if (theme === "light" || theme === "dark" || theme === "auto") {
          void vscode.workspace
            .getConfiguration("penmark")
            .update("theme", theme, vscode.ConfigurationTarget.Global);
        }
        break;
      }

      case "updateSetting": {
        const key = (message as { key?: unknown }).key;
        const value = (message as { value?: unknown }).value;
        if (
          typeof key === "string" &&
          (typeof value === "string" || typeof value === "number")
        ) {
          void handleUpdateSetting(key as PreviewSettingKey, value);
        }
        break;
      }

      case "scrolled": {
        // Webview scrolled — reveal the matching source line in the editor.
        // Gated by penmark.scrollSync; opens the host echo-suppression window
        // so the resulting VisibleRanges change is NOT bounced back as a fresh
        // revealLine (the webview suppresses its own scroll echo similarly).
        if (!configuredScrollSync()) break;
        const topLine = message.topLine;
        if (typeof topLine !== "number") break;
        const editor = findEditorForEntry(entry);
        if (!editor) break;
        entry.suppressVisibleRangeUntil = Date.now() + SCROLL_ECHO_SUPPRESS_MS;
        editor.revealRange(
          new vscode.Range(topLine, 0, topLine, 0),
          vscode.TextEditorRevealType.AtTop,
        );
        break;
      }

      case "copyCode": {
        const text = message.text;
        if (typeof text !== "string") break;
        // Write to the clipboard, then ack the webview so it can flash
        // "Copied ✓" only after the write was actually issued.
        void handleCopyCode(text).then(() => {
          const ack: Extract<HostToWebview, { type: "copied" }> = { v: 1, type: "copied" };
          void entry.panel.webview.postMessage(ack);
        });
        break;
      }

      case "addComment": {
        // Webview requested a new comment on a selection (R7). range is BODY-
        // relative char offsets (the offset-base seam — see comments.ts); the
        // host rebases to source coordinates inside planAddComment.
        const doc = entry.document;
        if (!doc) break;
        const { range, quote, body } = message;
        if (
          !range ||
          typeof range.start !== "number" ||
          typeof range.end !== "number" ||
          typeof quote !== "string" ||
          typeof body !== "string"
        ) {
          break;
        }
        const r = { start: range.start, end: range.end };
        enqueueMutation(entry, () => handleAddComment(doc, r, quote, body));
        break;
      }

      case "resolveComment": {
        const doc = entry.document;
        if (!doc) break;
        const id = message.id;
        if (typeof id !== "string") break;
        enqueueMutation(entry, () => handleResolveComment(doc, id));
        break;
      }

      case "editComment": {
        const doc = entry.document;
        if (!doc) break;
        const id = message.id;
        const body = message.body;
        if (typeof id !== "string" || typeof body !== "string") break;
        enqueueMutation(entry, () => handleEditComment(doc, id, body));
        break;
      }

      case "jumpToSource": {
        const doc = entry.document;
        if (!doc) break;
        const id = message.id;
        if (typeof id !== "string") break;
        const analysis = analyzeComments(doc.getText());
        const rc = analysis.result.comments.find((c) => c.entry.id === id);
        if (rc) {
          const start = rc.extent ? rc.extent.start : rc.entry.rawStart;
          const end = rc.extent ? rc.extent.end : rc.entry.rawEnd;
          void vscode.window
            .showTextDocument(doc, { preserveFocus: false })
            .then((editor) => {
              const startPos = doc.positionAt(start);
              const endPos = doc.positionAt(end);
              const range = new vscode.Range(startPos, endPos);
              editor.selection = new vscode.Selection(startPos, endPos);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            });
        }
        break;
      }

      case "openLink": {
        const href = message.href;
        if (!href) break;
        try {
          if (/^https?:\/\//i.test(href)) {
            // External URL — open in the system browser.
            void vscode.env.openExternal(vscode.Uri.parse(href, true));
          } else {
            // Relative or local path — resolve against the document directory
            // and open inside VS Code.
            const doc = entry.document;
            if (!doc) break;
            const docDir = path.dirname(doc.uri.fsPath);
            const absolutePath = path.isAbsolute(href) ? href : path.resolve(docDir, href);
            const fileUri = vscode.Uri.file(absolutePath);
            void vscode.commands.executeCommand("vscode.open", fileUri);
          }
        } catch {
          // Malformed href — swallow silently; we must not crash the host.
        }
        break;
      }

      case "toggleTaskCheckbox": {
        const doc = entry.document;
        if (!doc) break;
        const line = message.line;
        const checked = message.checked;
        if (typeof line !== "number" || typeof checked !== "boolean") break;
        enqueueMutation(entry, () => handleToggleTaskCheckbox(doc, line, checked));
        break;
      }
    }
  });

  // Observe penmark.theme config changes and push setTheme to this panel.
  const configListener = attachConfigListener(entry);

  // Observe editor scroll and push revealLine to this panel (T10, scroll sync).
  const visibleRangeListener = attachVisibleRangeListener(entry);

  // Clean up when the panel is closed: drop it from the map and dispose the
  // per-panel listeners so they never fire on a disposed webview.
  panel.onDidDispose(() => {
    panels.delete(key);
    configListener.dispose();
    visibleRangeListener.dispose();
  });

  return entry;
}

function openOrReveal(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
  const targetColumn = vscode.ViewColumn.Beside;

  const existing = panels.get(targetColumn);
  if (existing) {
    existing.panel.reveal(targetColumn, true /* preserveFocus */);
    void postRender(existing, document);
    return;
  }

  const distUri = vscode.Uri.joinPath(context.extensionUri, "dist");
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri);
  const localResourceRoots = [distUri, ...workspaceRoots];

  const panel = vscode.window.createWebviewPanel(
    "penmark.preview",
    "Penmark Preview",
    { viewColumn: targetColumn, preserveFocus: true },
    {
      enableScripts: true,
      localResourceRoots,
    },
  );

  setupPanelEntry(context, panel, document, targetColumn);
}

let customEditorSeq = 0;

export async function registerCustomEditorPreview(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
): Promise<void> {
  const key = `custom-${document.uri.toString()}-${customEditorSeq++}`;

  const distUri = vscode.Uri.joinPath(context.extensionUri, "dist");
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri);
  
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [distUri, ...workspaceRoots],
  };

  setupPanelEntry(context, panel, document, key);
}

// ---------------------------------------------------------------------------
// Document change listener (debounced)
// ---------------------------------------------------------------------------

export function registerChangeListener(): vscode.Disposable {
  return vscode.workspace.onDidChangeTextDocument((event) => {
    const document = event.document;
    if (document.languageId !== "markdown") return;

    // Only re-render if there is an open panel.
    if (panels.size === 0) return;

    const key = document.uri.toString();
    const existing = debounceTimers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      debounceTimers.delete(key);
      panels.forEach((entry) => {
        if (entry.document && entry.document.uri.toString() === document.uri.toString()) {
          void postRender(entry, document);
        }
      });
    }, DEBOUNCE_MS);

    debounceTimers.set(key, timer);
  });
}

// ---------------------------------------------------------------------------
// Webview panel serializer (for window revival)
// ---------------------------------------------------------------------------

export class PreviewPanelSerializer implements vscode.WebviewPanelSerializer {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async deserializeWebviewPanel(panel: vscode.WebviewPanel, savedState: unknown): Promise<void> {
    void savedState;
    const column = panel.viewColumn ?? vscode.ViewColumn.Beside;

    const activeEditor = vscode.window.activeTextEditor;
    const activeDoc =
      activeEditor && activeEditor.document.languageId === "markdown"
        ? activeEditor.document
        : undefined;

    setupPanelEntry(this.context, panel, activeDoc, column);
  }
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export function openPreview(context: vscode.ExtensionContext): void {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor || activeEditor.document.languageId !== "markdown") {
    void vscode.window.showWarningMessage("Penmark: open a Markdown file to preview.");
    return;
  }
  openOrReveal(context, activeEditor.document);
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

/**
 * Exported manager object — provides observable state for layer-4 tests.
 * Production code in extension.ts accesses panels via openPreview() only.
 */
export const previewManager = {
  /** Number of active panels across all columns. */
  panelCount(): number {
    return panels.size;
  },

  /** Shell HTML of the most recently created panel. */
  lastHtml(): string | undefined {
    const entries = [...panels.values()];
    return entries[entries.length - 1]?.html;
  },

  /** retainContextWhenHidden setting of the most recently created panel. */
  lastRetainContext(): boolean | undefined {
    const entries = [...panels.values()];
    return entries[entries.length - 1]?.retainContext;
  },

  /** Total number of render messages posted since the last resetRenderCount(). */
  renderCount(): number {
    return _totalRenderCount;
  },

  /** Reset the render count (call before the edit you want to measure). */
  resetRenderCount(): void {
    _totalRenderCount = 0;
    panels.forEach((entry) => {
      entry.renderCount = 0;
    });
  },

  /** Last `render` message payload sent by any panel. */
  lastRenderMessage(): Extract<HostToWebview, { type: "render" }> | undefined {
    const entries = [...panels.values()];
    return entries[entries.length - 1]?.lastRenderMessage;
  },

  /** Last `setTheme` message payload posted by any panel (config-driven). */
  lastSetThemeMessage(): Extract<HostToWebview, { type: "setTheme" }> | undefined {
    const entries = [...panels.values()];
    return entries[entries.length - 1]?.lastSetThemeMessage;
  },

  /** Last `revealLine` message payload posted by any panel (scroll sync, T10). */
  lastRevealLineMessage(): Extract<HostToWebview, { type: "revealLine" }> | undefined {
    const entries = [...panels.values()];
    return entries[entries.length - 1]?.lastRevealLineMessage;
  },

  /**
   * Test-only seam: the most recently created panel entry, so the layer-4 test
   * can drive {@link maybePostRevealLine} directly when the harness does not
   * reliably fire onDidChangeTextEditorVisibleRanges (T10).
   */
  lastEntry(): PanelEntry | undefined {
    const entries = [...panels.values()];
    return entries[entries.length - 1];
  },
} as const;
