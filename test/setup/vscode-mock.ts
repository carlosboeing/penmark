/**
 * Minimal `vscode` module mock for the vitest "host" project (src/vscode unit
 * tests). The real `vscode` module is only available inside the Electron host
 * (layer-4 @vscode/test-electron, broken on this macOS host — D16). This mock
 * provides just the surface src/vscode logic units exercise; it is aliased in
 * vitest.config.ts for the "host" project only.
 *
 * Keep it tiny and behavioural — add API surface here as host unit tests need it.
 */

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  constructor(
    public readonly start: Position,
    public readonly end: Position,
  ) {}
}

/** One recorded edit operation, for test inspection. */
export interface RecordedReplace {
  uri: unknown;
  range: Range;
  newText: string;
}

export class WorkspaceEdit {
  /** Recorded replace operations, in call order (test seam). */
  readonly _replaces: RecordedReplace[] = [];

  replace(uri: unknown, range: Range, newText: string): void {
    this._replaces.push({ uri, range, newText });
  }

  /** Total operations queued (matches the real API's `size`). */
  get size(): number {
    return this._replaces.length;
  }
}

/** Parsed-URI cache so `Uri.parse(x)` returns a reference-stable value: two
 *  calls with the same string yield the identical object, which keeps
 *  `toHaveBeenCalledWith(Uri.parse(...))` assertions robust. */
const _parsedUris = new Map<string, { scheme: string; toString: () => string }>();

export const Uri = {
  file(p: string): { fsPath: string; scheme: string; toString: () => string } {
    return { fsPath: p, scheme: "file", toString: () => `file://${p}` };
  },
  joinPath(
    base: { fsPath: string },
    ...segments: string[]
  ): { fsPath: string; scheme: string; toString: () => string } {
    const joined = [base.fsPath.replace(/\/$/, ""), ...segments].join("/");
    return { fsPath: joined, scheme: "file", toString: () => `file://${joined}` };
  },
  // A second `strict` argument (as VS Code's Uri.parse accepts) is ignored here.
  parse(value: string): { scheme: string; toString: () => string } {
    let uri = _parsedUris.get(value);
    if (!uri) {
      const colon = value.indexOf(":");
      uri = { scheme: colon > 0 ? value.slice(0, colon) : "", toString: () => value };
      _parsedUris.set(value, uri);
    }
    return uri;
  },
};

/** Clipboard + external-open seam. Tests read `env.clipboard._text` and can
 *  spy on `env.openExternal`. */
export const env = {
  clipboard: {
    _text: "" as string,
    writeText(value: string): Promise<void> {
      env.clipboard._text = value;
      return Promise.resolve();
    },
  },
  // The opened target is irrelevant to the seam; tests spy on the call itself.
  openExternal(): Promise<boolean> {
    return Promise.resolve(true);
  },
};

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;
export const ProgressLocation = { Notification: 15 } as const;
export const ViewColumn = { One: 1, Beside: 2 } as const;

/**
 * Configuration store the host mock reads. Tests set values via
 * `__setConfig("penmark", { "comments.authorName": "Ada" })` before exercising
 * resolveAuthor(). Defaults to empty (so resolveAuthor falls through to git).
 */
const configStore = new Map<string, Record<string, unknown>>();

export function __setConfig(section: string, values: Record<string, unknown>): void {
  configStore.set(section, values);
}

export function __resetConfig(): void {
  configStore.clear();
}

export const workspace = {
  workspaceFolders: [] as Array<{ uri: ReturnType<typeof Uri.file> }>,
  /** WorkspaceEdits passed to applyEdit, in call order (test seam). */
  _appliedEdits: [] as WorkspaceEdit[],
  /** Configuration writes via getConfiguration().update(), in call order. */
  _configUpdates: [] as Array<{
    section: string;
    key: string;
    value: unknown;
    target: unknown;
  }>,
  /** Files written via workspace.fs.writeFile, keyed by fsPath (test seam). */
  _writtenFiles: new Map<string, string>(),
  _resetEdits(): void {
    this._appliedEdits.length = 0;
    this._configUpdates.length = 0;
    this._writtenFiles.clear();
  },
  /** Minimal FileSystem: records writeFile so tests can assert the file path/content. */
  fs: {
    readFile(): Promise<Uint8Array> {
      return Promise.resolve(new TextEncoder().encode(""));
    },
    writeFile(uri: { fsPath: string }, content: Uint8Array): Promise<void> {
      workspace._writtenFiles.set(uri.fsPath, new TextDecoder().decode(content));
      return Promise.resolve();
    },
  },
  /** A document's path relative to the workspace — the mock returns the basename. */
  asRelativePath(uri: { fsPath: string } | string): string {
    const p = typeof uri === "string" ? uri : uri.fsPath;
    return p.replace(/^.*\//, "");
  },
  getConfiguration(section: string) {
    const values = configStore.get(section) ?? {};
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        return key in values ? (values[key] as T) : defaultValue;
      },
      update(key: string, value: unknown, target: unknown): Promise<void> {
        workspace._configUpdates.push({ section, key, value, target });
        values[key] = value;
        configStore.set(section, values);
        return Promise.resolve();
      },
    };
  },
  applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    this._appliedEdits.push(edit);
    return Promise.resolve(true);
  },
  onDidChangeConfiguration(): { dispose: () => void } {
    return { dispose(): void {} };
  },
  onDidChangeTextDocument(): { dispose: () => void } {
    return { dispose(): void {} };
  },
};

export const commands = {
  _registrations: [] as Array<{ command: string; callback: (...args: unknown[]) => unknown }>,
  registerCommand(
    command: string,
    callback: (...args: unknown[]) => unknown,
  ): { dispose: () => void } {
    this._registrations.push({ command, callback });
    return { dispose(): void {} };
  },
  // Execution is irrelevant to the seam; tests spy on the call itself.
  executeCommand(): Promise<unknown> {
    return Promise.resolve(undefined);
  },
};

export const window = {
  activeTextEditor: undefined as
    | {
        document: {
          languageId: string;
          uri: ReturnType<typeof Uri.file>;
          getText: () => string;
          positionAt: (offset: number) => Position;
        };
      }
    | undefined,
  visibleTextEditors: [] as Array<{
    document: { uri: { toString: () => string } };
    edit: (
      callback: (builder: { replace: (range: Range, newText: string) => void }) => void,
      options?: { undoStopBefore: boolean; undoStopAfter: boolean },
    ) => Promise<boolean>;
  }>,
  _warnings: [] as string[],
  _infos: [] as string[],
  /** Lines written to any "Penmark" output channel (test seam). */
  _outputLines: [] as string[],
  _createWebviewPanelCalls: [] as Array<{
    viewType: string;
    title: string;
    showOptions: unknown;
    options: unknown;
  }>,
  _createdWebviewPanels: [] as Array<{ dispose: () => void }>,
  _registerCustomEditorProviderCalls: [] as Array<{
    viewType: string;
    provider: unknown;
    options: unknown;
  }>,
  _resetMessages(): void {
    this._warnings.length = 0;
    this._infos.length = 0;
    this._outputLines.length = 0;
    this._quickPickChoice = undefined;
  },
  showWarningMessage(message: string): Promise<undefined> {
    this._warnings.push(message);
    return Promise.resolve(undefined);
  },
  showInformationMessage(message: string): Promise<undefined> {
    this._infos.push(message);
    return Promise.resolve(undefined);
  },
  showErrorMessage(message: string): Promise<undefined> {
    this._warnings.push(message);
    return Promise.resolve(undefined);
  },
  withProgress<T>(_options: unknown, task: () => Thenable<T> | Promise<T> | T): Promise<T> {
    return Promise.resolve(task());
  },
  /** The next showQuickPick return value; set by tests via __setQuickPickChoice. */
  _quickPickChoice: undefined as string | undefined,
  showQuickPick(): Promise<string | undefined> {
    return Promise.resolve(window._quickPickChoice);
  },
  createOutputChannel(name: string): {
    name: string;
    appendLine: (line: string) => void;
    append: (value: string) => void;
    clear: () => void;
    show: () => void;
    hide: () => void;
    dispose: () => void;
    replace: (value: string) => void;
  } {
    return {
      name,
      appendLine: (line: string): void => {
        window._outputLines.push(line);
      },
      append: (): void => {},
      clear: (): void => {},
      show: (): void => {},
      hide: (): void => {},
      dispose: (): void => {},
      replace: (): void => {},
    };
  },
  createWebviewPanel(
    viewType: string,
    title: string,
    showOptions: unknown,
    options: unknown,
  ): unknown {
    window._createWebviewPanelCalls.push({ viewType, title, showOptions, options });
    const disposable = { dispose(): void {} };
    let disposeListener: (() => void) | undefined;
    const panel = {
      viewColumn: ViewColumn.Beside,
      dispose(): void {
        const listener = disposeListener;
        disposeListener = undefined;
        listener?.();
      },
      reveal(): void {},
      onDidDispose(listener: () => void) {
        disposeListener = listener;
        return disposable;
      },
      webview: {
        cspSource: "test-csp",
        html: "",
        asWebviewUri: (uri: unknown) => uri,
        postMessage: () => Promise.resolve(true),
        onDidReceiveMessage: () => disposable,
      },
    };
    window._createdWebviewPanels.push(panel);
    return panel;
  },
  onDidChangeTextEditorVisibleRanges(): { dispose: () => void } {
    return { dispose(): void {} };
  },
  registerWebviewPanelSerializer(): { dispose: () => void } {
    return { dispose(): void {} };
  },
  registerCustomEditorProvider(
    viewType: string,
    provider: unknown,
    options: unknown,
  ): { dispose: () => void } {
    window._registerCustomEditorProviderCalls.push({ viewType, provider, options });
    return { dispose(): void {} };
  },
};
