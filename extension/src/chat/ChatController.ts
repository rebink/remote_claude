import * as vscode from 'vscode';
import { CliClient } from '../cli/CliClient.ts';
import type { CliEvent, ChangedFile } from '../cli/events.ts';
import { ChatStore } from './ChatStore.ts';
import type { ChatPanel } from './ChatPanel.ts';

export class ChatController {
  private inFlight = new Map<string, ReturnType<CliClient['spawn']>>();
  panel!: ChatPanel;

  constructor(
    private readonly cli: CliClient,
    private readonly store: ChatStore,
    private readonly output: vscode.OutputChannel,
  ) {}

  async send(chatId: string, prompt: string): Promise<void> {
    if (this.inFlight.has(chatId)) {
      vscode.window.showWarningMessage('A turn is already in flight for this chat.');
      return;
    }
    this.store.appendTurn(chatId, { role: 'user', text: prompt, timestamp: Date.now() });
    this.store.appendTurn(chatId, { role: 'assistant', text: '', timestamp: Date.now(), patch: null });
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
        } else if (ev.type === 'error') {
          this.output.appendLine(`[error] ${ev.code}: ${ev.message}`);
          this.store.appendTurn(chatId, { role: 'system', text: `Error: ${ev.message}`, timestamp: Date.now() });
        }
      }
    } finally {
      this.inFlight.delete(chatId);
      this.panel.setInFlight(chatId, false);
    }
  }

  cancel(chatId: string): void { this.inFlight.get(chatId)?.cancel(); }

  private replaceLastAssistant(chatId: string, text: string, patch: string | null, files: ChangedFile[]): void {
    const turns = this.store.loadTranscript(chatId);
    turns[turns.length - 1] = { role: 'assistant', text, timestamp: Date.now(), patch, files };
    this.store.rewriteTranscript(chatId, turns);
    this.panel.postState();
  }
}
