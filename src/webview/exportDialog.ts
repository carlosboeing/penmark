/**
 * Export options dialog (R17): a modal opened from the topbar Export button
 * or by the host (palette/menu command path, `exportShowOptions`). Confirming
 * posts `exportRequest` — the host runs the actual export.
 *
 * Reuses the settings-panel control classes (segmented groups) so the export
 * dialog and the settings panel read as one design system. Native <dialog>
 * gives focus trapping and Esc-to-close for free.
 *
 * No vscode imports (ADR 0001); no inline styles (CSP).
 */

import type { ExportKind, ExportOptions, WebviewToHost } from "../core/protocol/messages.js";

type PostMessage = (msg: WebviewToHost) => void;

interface DialogInternals {
  el: HTMLDialogElement;
  content: HTMLElement;
  post: PostMessage;
  onDismiss?: () => void;
}

let _dialog: DialogInternals | null = null;
/** Working copy of the options while the dialog is open. */
let _draft: { kind: ExportKind; options: ExportOptions } | null = null;

export function isExportDialogOpen(): boolean {
  return _dialog?.el.open ?? false;
}

/** Create (once) the dialog shell and remember the post channel. */
export function ensureExportDialog(post: PostMessage, onDismiss?: () => void): HTMLDialogElement {
  if (_dialog && document.body.contains(_dialog.el)) {
    _dialog.post = post;
    _dialog.onDismiss = onDismiss;
    return _dialog.el;
  }

  const el = document.createElement("dialog");
  el.className = "pmk-export-dialog";
  el.setAttribute("aria-label", "Export options");
  el.addEventListener("cancel", () => {
    _dialog?.onDismiss?.();
  });

  const head = document.createElement("div");
  head.className = "pmk-settings-head";
  const title = document.createElement("span");
  title.className = "pmk-settings-title";
  title.textContent = "Export document";
  head.appendChild(title);

  const content = document.createElement("div");
  content.className = "pmk-export-dialog-content";

  el.append(head, content);
  document.body.appendChild(el);

  _dialog = { el, content, post, onDismiss };
  return el;
}

/** Open the dialog for `kind`, pre-filled from host-provided defaults. */
export function openExportDialog(kind: ExportKind, defaults: ExportOptions): void {
  if (!_dialog) return;
  _draft = { kind, options: { ...defaults } };
  renderContent();
  if (!_dialog.el.open) {
    _dialog.el.showModal();
  }
}

export function closeExportDialog(
  reason: "cancel" | "confirmed" | "programmatic" = "programmatic",
): void {
  if (reason === "cancel") {
    _dialog?.onDismiss?.();
  }
  _dialog?.el.close();
  _draft = null;
}

function segmented<T extends string>(
  legendText: string,
  values: Array<{ value: T; label: string }>,
  current: T,
  onPick: (value: T) => void,
): HTMLElement {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "pmk-settings-group";
  const legend = document.createElement("legend");
  legend.textContent = legendText;
  fieldset.appendChild(legend);

  const row = document.createElement("div");
  row.className = "pmk-settings-segmented";
  for (const option of values) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pmk-settings-option";
    btn.textContent = option.label;
    btn.setAttribute("data-value", option.value);
    btn.setAttribute("aria-pressed", option.value === current ? "true" : "false");
    btn.addEventListener("click", () => {
      onPick(option.value);
      renderContent();
    });
    row.appendChild(btn);
  }
  fieldset.appendChild(row);
  return fieldset;
}

function checkbox(
  labelText: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const label = document.createElement("label");
  label.className = "pmk-export-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => {
    onChange(input.checked);
  });
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(input, text);
  return label;
}

function renderContent(): void {
  if (!_dialog || !_draft) return;
  const draft = _draft;
  const { options } = draft;
  _dialog.content.replaceChildren();

  _dialog.content.appendChild(
    segmented(
      "Format",
      [
        { value: "html", label: "HTML" },
        { value: "pdf", label: "PDF" },
      ],
      draft.kind,
      (v) => (draft.kind = v),
    ),
  );

  const include = document.createElement("fieldset");
  include.className = "pmk-settings-group";
  const includeLegend = document.createElement("legend");
  includeLegend.textContent = "Include";
  include.appendChild(includeLegend);
  include.appendChild(
    checkbox("Frontmatter card", options.includeFrontmatter, (v) => {
      options.includeFrontmatter = v;
    }),
  );
  include.appendChild(
    checkbox("Table of contents", options.includeToc, (v) => {
      options.includeToc = v;
    }),
  );
  _dialog.content.appendChild(include);

  _dialog.content.appendChild(
    segmented(
      "Width",
      [
        { value: "comfortable", label: "Comfortable" },
        { value: "wide", label: "Wide" },
        { value: "full", label: "Full" },
      ],
      options.width,
      (v) => (options.width = v),
    ),
  );

  if (draft.kind === "pdf") {
    _dialog.content.appendChild(
      segmented(
        "Page size",
        [
          { value: "a4", label: "A4" },
          { value: "letter", label: "Letter" },
        ],
        options.pdfPageSize,
        (v) => (options.pdfPageSize = v),
      ),
    );
    _dialog.content.appendChild(
      segmented(
        "Margins",
        [
          { value: "narrow", label: "Narrow" },
          { value: "normal", label: "Normal" },
          { value: "wide", label: "Wide" },
        ],
        options.pdfMargin,
        (v) => (options.pdfMargin = v),
      ),
    );
    const pageChrome = document.createElement("fieldset");
    pageChrome.className = "pmk-settings-group";
    const legend = document.createElement("legend");
    legend.textContent = "Page chrome";
    pageChrome.appendChild(legend);
    pageChrome.appendChild(
      checkbox("Header and page numbers", options.pdfHeaderFooter, (v) => {
        options.pdfHeaderFooter = v;
      }),
    );
    _dialog.content.appendChild(pageChrome);
  }

  const actions = document.createElement("div");
  actions.className = "pmk-export-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "pmk-settings-option";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => closeExportDialog("cancel"));
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "pmk-export-confirm";
  confirm.textContent = draft.kind === "pdf" ? "Export PDF" : "Export HTML";
  confirm.addEventListener("click", () => {
    _dialog?.post({ v: 1, type: "exportRequest", kind: draft.kind, options: { ...options } });
    closeExportDialog("confirmed");
  });
  actions.append(cancel, confirm);
  _dialog.content.appendChild(actions);
}
