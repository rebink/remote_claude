// Minimal vscode API stub for vitest unit tests.
// Only the surface area used by modules under test needs to exist; tests that
// exercise vscode behaviour should be moved to integration (@vscode/test-electron).

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  readonly event = (listener: (e: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };
  fire(data: T): void {
    for (const l of this.listeners) l(data);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export const workspace = {
  createFileSystemWatcher: (_glob: string) => ({
    onDidChange: (_cb: unknown) => ({ dispose: () => {} }),
    onDidCreate: (_cb: unknown) => ({ dispose: () => {} }),
    onDidDelete: (_cb: unknown) => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  asRelativePath: (uri: { fsPath?: string; path?: string } | string): string =>
    typeof uri === 'string' ? uri : (uri.fsPath ?? uri.path ?? ''),
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string): T | undefined => undefined,
  }),
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, path }),
  joinPath: (base: { fsPath?: string; path?: string }, ...parts: string[]) => {
    const base_ = base.fsPath ?? base.path ?? '';
    const joined = [base_, ...parts].join('/');
    return { fsPath: joined, path: joined };
  },
};

export class RelativePattern {
  constructor(
    public readonly base: string | { fsPath?: string; path?: string },
    public readonly pattern: string,
  ) {}
}

export enum ViewColumn {
  Active = -1,
  One = 1,
  Two = 2,
}

export const window = {
  createWebviewPanel: (
    _viewType: string,
    _title: string,
    _showOptions: unknown,
    _options?: unknown,
  ) => ({
    webview: {
      html: '',
      postMessage: (_msg: unknown) => Promise.resolve(true),
      onDidReceiveMessage: (_cb: unknown) => ({ dispose: () => {} }),
      asWebviewUri: (uri: { fsPath?: string; path?: string } | string) =>
        typeof uri === 'string' ? uri : (uri.fsPath ?? uri.path ?? ''),
      cspSource: 'self',
    },
    onDidDispose: (_cb: unknown) => ({ dispose: () => {} }),
    reveal: () => {},
    dispose: () => {},
  }),
  showWarningMessage: async (..._args: unknown[]) => undefined as unknown,
  showErrorMessage: async (..._args: unknown[]) => undefined as unknown,
  showInformationMessage: async (..._args: unknown[]) => undefined as unknown,
  createTerminal: (_opts?: unknown) => ({
    name: 'stub',
    sendText: (_t: string) => {},
    show: () => {},
    dispose: () => {},
  }),
  terminals: [] as unknown[],
  activeTerminal: undefined as unknown,
  onDidCloseTerminal: (_cb: unknown) => ({ dispose: () => {} }),
  onDidOpenTerminal: (_cb: unknown) => ({ dispose: () => {} }),
  registerTreeDataProvider: (_id: string, _provider: unknown) => ({ dispose: () => {} }),
  createTreeView: (_id: string, _opts: unknown) => ({
    onDidChangeVisibility: (_cb: (e: { visible: boolean }) => void) => ({ dispose: () => {} }),
    visible: false,
    dispose: () => {},
  }),
};

export const env = {
  clipboard: { writeText: async (_text: string) => {} },
};

export const commands = {
  executeCommand: async (_command: string, ..._args: unknown[]) => undefined,
};

export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export class TreeItem {
  label?: string;
  description?: string;
  iconPath?: unknown;
  contextValue?: string;
  tooltip?: string;
  collapsibleState?: TreeItemCollapsibleState;
  constructor(label?: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}
