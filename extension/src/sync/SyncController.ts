import * as vscode from 'vscode';
import { CliClient } from '../cli/CliClient.ts';

export class Debouncer {
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly fn: () => void,
    private readonly ms: number,
  ) {}

  trigger(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fn();
    }, this.ms);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.fn();
    }
  }
}

export class SyncController {
  private watcher?: vscode.FileSystemWatcher;
  private debouncer: Debouncer;
  private liveSync = false;
  private suspended = false;
  private outOfSync = new Set<string>();
  private readonly onChange = new vscode.EventEmitter<void>();
  readonly stateChanged = this.onChange.event;

  constructor(
    private readonly cli: CliClient,
    private readonly output: vscode.OutputChannel,
  ) {
    this.debouncer = new Debouncer(
      () =>
        this.runRsync().catch((e) =>
          this.output.appendLine(`sync error: ${(e as Error).message}`),
        ),
      500,
    );
  }

  setLiveSync(on: boolean): void {
    this.liveSync = on;
    if (on) this.startWatcher();
    else this.stopWatcher();
    this.onChange.fire();
  }

  isLiveSync(): boolean {
    return this.liveSync;
  }

  getOutOfSyncFiles(): string[] {
    return [...this.outOfSync];
  }

  suspendForMs(ms: number): void {
    this.suspended = true;
    setTimeout(() => {
      this.suspended = false;
    }, ms);
  }

  async syncOnce(): Promise<void> {
    await this.runRsync();
  }

  private startWatcher(): void {
    if (this.watcher) return;
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const onAny = (uri: vscode.Uri) => {
      if (this.suspended) return;
      const rel = vscode.workspace.asRelativePath(uri);
      this.outOfSync.add(rel);
      this.onChange.fire();
      this.debouncer.trigger();
    };
    this.watcher.onDidChange(onAny);
    this.watcher.onDidCreate(onAny);
    this.watcher.onDidDelete(onAny);
  }

  private stopWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  private async runRsync(): Promise<void> {
    const run = this.cli.spawn(['sync', '--json']);
    let errored = false;
    for await (const e of run.events) {
      if (e.type === 'error') {
        errored = true;
        this.output.appendLine(`sync error: ${e.code}: ${e.message}`);
      }
    }
    if (!errored) {
      this.outOfSync.clear();
    }
    this.onChange.fire();
  }
}
