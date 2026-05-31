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
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, path }),
  joinPath: (base: { fsPath?: string; path?: string }, ...parts: string[]) => {
    const base_ = base.fsPath ?? base.path ?? '';
    const joined = [base_, ...parts].join('/');
    return { fsPath: joined, path: joined };
  },
};

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
};

export const commands = {
  executeCommand: async (_command: string, ..._args: unknown[]) => undefined,
};
