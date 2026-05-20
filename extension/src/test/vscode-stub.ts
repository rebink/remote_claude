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
};
