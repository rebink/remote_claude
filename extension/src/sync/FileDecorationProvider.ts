import * as vscode from 'vscode';
import type { SyncController } from './SyncController.ts';

export class FileDecorationProvider implements vscode.FileDecorationProvider {
  private emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private pendingFiles = new Set<string>();
  private readonly subscription: vscode.Disposable;

  constructor(private readonly sync: SyncController) {
    this.subscription = this.sync.stateChanged(() => this.emitter.fire(undefined));
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }

  setPendingDiffFiles(paths: string[]): void {
    this.pendingFiles = new Set(paths);
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const rel = vscode.workspace.asRelativePath(uri);
    if (this.pendingFiles.has(rel)) {
      return { badge: '▼', tooltip: 'Pending Claude diff', color: new vscode.ThemeColor('charts.blue') };
    }
    if (this.sync.getOutOfSyncFiles().includes(rel)) {
      return { badge: '●', tooltip: 'Not synced to remote', color: new vscode.ThemeColor('charts.orange') };
    }
    return undefined;
  }
}
