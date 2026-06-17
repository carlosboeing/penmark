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

export const Uri = {
  file(p: string): { fsPath: string; scheme: string; toString: () => string } {
    return { fsPath: p, scheme: "file", toString: () => `file://${p}` };
  },
};

/** Clipboard seam: tests read `env.clipboard._text`. */
export const env = {
  clipboard: {
    _text: "" as string,
    writeText(value: string): Promise<void> {
      env.clipboard._text = value;
      return Promise.resolve();
    },
  },
};

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

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
};

export const window = {
  _warnings: [] as string[],
  _infos: [] as string[],
  /** Lines written to any "Penmark" output channel (test seam). */
  _outputLines: [] as string[],
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
};
