import * as vscode from 'vscode';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { SyncController } from '../sync/SyncController.ts';

export class StatusBarController {
  private item: vscode.StatusBarItem;
  private statePath: string;

  constructor(ws: string, private readonly sync: SyncController) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'remoteClaude.toggleLiveSync';
    this.statePath = join(ws, '.remote-claude', 'state.json');
    this.sync.setLiveSync(this.loadLiveSync());
    this.sync.stateChanged(() => this.refresh());
    this.refresh();
    this.item.show();
  }

  toggle(): void {
    const next = !this.sync.isLiveSync();
    this.sync.setLiveSync(next);
    this.persistLiveSync(next);
  }

  dispose(): void { this.item.dispose(); }

  private refresh(): void {
    if (this.sync.isLiveSync()) { this.item.text = '$(zap) Live sync: ON'; return; }
    const dirty = this.sync.getOutOfSyncFiles().length;
    this.item.text = dirty ? `$(warning) ${dirty} files not synced` : '$(sync) In sync';
  }

  private loadLiveSync(): boolean {
    if (!existsSync(this.statePath)) return false;
    try { return !!JSON.parse(readFileSync(this.statePath, 'utf8')).liveSync; } catch { return false; }
  }

  private persistLiveSync(on: boolean): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    let state: Record<string, unknown> = {};
    if (existsSync(this.statePath)) {
      try { state = JSON.parse(readFileSync(this.statePath, 'utf8')); } catch { /* ignore */ }
    }
    state.liveSync = on;
    writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }
}
