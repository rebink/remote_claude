import * as vscode from 'vscode';
import { CliClient } from '../cli/CliClient.ts';
import type { CliEvent, ChangedFile } from '../cli/events.ts';
import { ChatStore } from './ChatStore.ts';
import type { ChatPanel } from './ChatPanel.ts';
import type { SyncController } from '../sync/SyncController.ts';
import type { StatusBarController } from '../statusbar/StatusBarController.ts';
import { applyPatch, filterPatchToFiles } from '../diff/applyPatch.ts';
import { makeBeforeUri } from '../diff/DiffContentProvider.ts';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const ERROR_MESSAGES: Record<string, string> = {
  cli_stderr:    'The CLI produced an error. Check Output → Remote Claude.',
  cli_spawn_error: 'Could not start the CLI. Make sure `remote-claude` is on your PATH and that the extension is up to date.',
  turn_failed:   'The remote couldn’t complete this turn.',
  timeout:       'Claude took too long. Try splitting the request, or increase RC_TIMEOUT_SEC on the remote.',
  busy:          'A turn is already in flight. Wait for it to finish.',
  unknown:       'An unexpected error occurred.',
};

export class ChatController {
  private inFlight = new Map<string, ReturnType<CliClient['spawn']>>();
  private throttle = new Map<string, {
    timeout: NodeJS.Timeout;
    latest: { text: string; patch: string | null; files: ChangedFile[] };
  }>();
  panel!: ChatPanel;
  onPendingDiffFiles?: (paths: string[]) => void;

  constructor(
    private readonly cli: CliClient,
    private readonly store: ChatStore,
    private readonly output: vscode.OutputChannel,
    private readonly syncCtrl: SyncController,
    private readonly status: StatusBarController,
  ) {}

  async send(chatId: string, prompt: string): Promise<void> {
    if (this.inFlight.has(chatId)) {
      vscode.window.showWarningMessage('A turn is already in flight for this chat.');
      return;
    }
    // Ask-time guard: warn when live-sync is off and the workspace is dirty.
    const dirty = this.syncCtrl.getOutOfSyncFiles();
    if (!this.syncCtrl.isLiveSync() && dirty.length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `${dirty.length} files changed since last sync.`,
        { modal: true },
        'Sync first', 'Turn on live sync', 'Send anyway'
      );
      if (choice === undefined) return;             // user dismissed; abort
      if (choice === 'Sync first') await this.syncCtrl.syncOnce();
      if (choice === 'Turn on live sync') this.status.setLiveSyncPersisted(true);
      // 'Send anyway' falls through. Note: the CLI's chat command syncs by default,
      // so this still pushes; differs from 'Sync first' only in that we don't wait for it.
    }
    this.store.appendTurn(chatId, { role: 'user', text: prompt, timestamp: Date.now() });
    this.store.appendTurn(chatId, { role: 'assistant', text: '', timestamp: Date.now(), patch: null });
    this.store.setInFlight(chatId, true);
    this.panel.setInFlight(chatId, true);

    const run = this.cli.spawn(['chat', '--session', chatId, '--json', prompt]);
    this.inFlight.set(chatId, run);

    let assistantText = '';
    let patch: string | null = null;
    let files: ChangedFile[] = [];

    try {
      for await (const e of run.events) {
        const ev = e as CliEvent;
        if (ev.type === 'chat_text') {
          assistantText += ev.chunk;
          this.replaceLastAssistant(chatId, assistantText, patch, files);
        } else if (ev.type === 'chat_diff') {
          patch = ev.patch;
          files = ev.files;
          this.replaceLastAssistant(chatId, assistantText, patch, files);
          this.onPendingDiffFiles?.(files.map((f) => f.path));
        } else if (ev.type === 'error') {
          const friendly = ERROR_MESSAGES[ev.code] ?? `${ev.code}: ${ev.message}`;
          this.store.appendTurn(chatId, { role: 'system', text: friendly, timestamp: Date.now() });
          this.output.appendLine(`[error ${ev.code}] ${ev.message}`);
          this.panel.postState();
        }
      }
    } finally {
      this.inFlight.delete(chatId);
      this.store.setInFlight(chatId, false);
      this.panel.setInFlight(chatId, false);
      // Flush any pending update for THIS chat so the final state is captured
      const slot = this.throttle.get(chatId);
      if (slot) {
        clearTimeout(slot.timeout);
        this.throttle.delete(chatId);
        if (this.store.hasChat(chatId)) {
          const turns = this.store.loadTranscript(chatId);
          if (turns.length > 0) {
            turns[turns.length - 1] = { role: 'assistant', text: slot.latest.text, timestamp: Date.now(), patch: slot.latest.patch, files: slot.latest.files };
            this.store.rewriteTranscript(chatId, turns);
            this.panel.postState();
          }
        }
      }
    }
  }

  cancel(chatId: string): void { this.inFlight.get(chatId)?.cancel(); }

  async activateRecovery(): Promise<void> {
    const stale = this.store.loadInFlight();
    for (const chatId of stale) {
      this.store.setInFlight(chatId, false);
      // We can't reattach to the stream (one-shot), so append a system turn explaining the situation.
      if (this.store.hasChat(chatId)) {
        this.store.appendTurn(chatId, {
          role: 'system',
          text: 'A previous chat turn was interrupted by a window reload. Re-send the prompt to retry.',
          timestamp: Date.now(),
        });
      }
    }
    if (stale.length > 0) this.panel.postState();
  }

  async handleDiffAction(input: { chatId: string; turn: number; action: 'apply'|'save'|'reject'; fileIndices: number[] }): Promise<void> {
    const turns = this.store.loadTranscript(input.chatId);
    const turn = turns[input.turn];
    if (!turn || !turn.patch || !turn.files) return;

    if (input.action === 'reject') {
      turn.rejected = true;
      this.store.rewriteTranscript(input.chatId, turns);
      this.panel.postState();
      this.onPendingDiffFiles?.([]);
      return;
    }
    if (input.action === 'save') {
      this.store.savePatch(input.chatId, input.turn, turn.patch);
      turn.saved = true;
      this.store.rewriteTranscript(input.chatId, turns);
      this.panel.postState();
      this.onPendingDiffFiles?.([]);
      vscode.window.showInformationMessage('Patch saved.');
      return;
    }

    // apply
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showErrorMessage('No workspace open.'); return; }
    const keep = input.fileIndices.map((i) => turn.files![i].path);
    const subset = filterPatchToFiles(turn.patch, keep);
    const res = await applyPatch(subset, ws);
    if (res.ok) {
      turn.applied = true;
      vscode.window.showInformationMessage(`Applied ${keep.length} file(s).`);
    } else if (res.conflicted.length > 0) {
      turn.applied = true;
      vscode.window.showWarningMessage(`Conflicts in: ${res.conflicted.join(', ')}. Resolve, then commit.`);
    } else {
      vscode.window.showErrorMessage(`git apply failed: ${res.stderr.split('\n')[0]}`);
      return;
    }
    this.store.rewriteTranscript(input.chatId, turns);
    this.panel.postState();
    this.onPendingDiffFiles?.([]);
  }

  async handleOpenDiff(input: { chatId: string; turn: number; fileIndex: number }): Promise<void> {
    const turns = this.store.loadTranscript(input.chatId);
    const turn = turns[input.turn];
    if (!turn || !turn.files || !turn.patch) return;
    const file = turn.files[input.fileIndex];

    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showErrorMessage('No workspace open.'); return; }
    const tmpDir = mkdtempSync(join(tmpdir(), 'rc-diff-'));
    // Mirror the workspace file structure inside tmpDir so git apply sees the right relative path
    const targetDir = join(tmpDir, dirname(file.path));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));
    const localPath = join(ws, file.path);
    const current = existsSync(localPath) ? readFileSync(localPath) : Buffer.alloc(0);
    writeFileSync(join(tmpDir, file.path), current);

    const single = filterPatchToFiles(turn.patch, [file.path]);
    const applyRes = await applyPatch(single, tmpDir);
    if (!applyRes.ok) {
      vscode.window.showWarningMessage(
        `Diff preview for ${file.path} may be inaccurate — the local file has drifted from Claude's input. Apply will use a 3-way merge against your current content.`
      );
    }

    const left = makeBeforeUri(file.path);
    const right = vscode.Uri.file(join(tmpDir, file.path));
    await vscode.commands.executeCommand('vscode.diff', left, right, `${file.path} (Claude proposal)`);
  }

  private replaceLastAssistant(chatId: string, text: string, patch: string | null, files: ChangedFile[]): void {
    const existing = this.throttle.get(chatId);
    if (existing) {
      existing.latest = { text, patch, files };
      return;
    }
    const slot = {
      latest: { text, patch, files },
      timeout: setTimeout(() => {
        const s = this.throttle.get(chatId);
        if (!s) return;
        if (!this.store.hasChat(chatId)) {
          this.throttle.delete(chatId);
          return;
        }
        const turns = this.store.loadTranscript(chatId);
        if (turns.length === 0) {
          this.throttle.delete(chatId);
          return;
        }
        turns[turns.length - 1] = { role: 'assistant', text: s.latest.text, timestamp: Date.now(), patch: s.latest.patch, files: s.latest.files };
        this.store.rewriteTranscript(chatId, turns);
        this.panel.postState();
        this.throttle.delete(chatId);
      }, 100),
    };
    this.throttle.set(chatId, slot);
  }
}
