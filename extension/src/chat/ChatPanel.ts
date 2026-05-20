import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatStore, Turn } from './ChatStore.ts';

export type DiffActionMsg = { chatId: string; turn: number; action: 'apply'|'save'|'reject'; fileIndices: number[] };
export type OpenDiffMsg = { chatId: string; turn: number; fileIndex: number };

export interface ChatPanelDeps {
  onSend(chatId: string, prompt: string): void;
  onDiffAction(msg: DiffActionMsg): void;
  onOpenDiff(msg: OpenDiffMsg): void;
  onCancel(chatId: string): void;
  onDeleteRemote(chatId: string): Promise<void>;
}

export class ChatPanel implements vscode.WebviewViewProvider {
  static readonly viewId = 'remoteClaude.chatPanel';
  private view?: vscode.WebviewView;
  private activeChatId?: string;
  private inFlightChats = new Set<string>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly chatStore: ChatStore,
    private readonly deps: ChatPanelDeps,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg: { type: string; [k: string]: unknown }) => {
      switch (msg.type) {
        case 'ready':       return this.postState();
        case 'send':        if (this.activeChatId) this.deps.onSend(this.activeChatId, msg.prompt as string); return;
        case 'newChat':     this.activeChatId = this.chatStore.createChat(`Chat ${this.chatStore.listChats().length + 1}`); return this.postState();
        case 'switch':      this.activeChatId = msg.id as string; return this.postState();
        case 'diffAction':  return this.deps.onDiffAction(msg as unknown as DiffActionMsg);
        case 'openDiff':    return this.deps.onOpenDiff(msg as unknown as OpenDiffMsg);
        case 'cancel':      if (this.activeChatId) this.deps.onCancel(this.activeChatId); return;
        case 'deleteChat': {
          const confirm = await vscode.window.showWarningMessage('Delete this chat?', { modal: true }, 'Delete');
          if (confirm !== 'Delete') return;
          const id = msg.id as string;
          this.chatStore.deleteChat(id);
          if (this.activeChatId === id) this.activeChatId = undefined;
          await this.deps.onDeleteRemote(id);
          return this.postState();
        }
      }
    });
  }

  setInFlight(chatId: string, on: boolean): void {
    if (on) this.inFlightChats.add(chatId); else this.inFlightChats.delete(chatId);
    this.postState();
  }

  postState(): void {
    if (!this.view) return;
    const chats = this.chatStore.listChats();
    if (!this.activeChatId && chats[0]) this.activeChatId = chats[0].id;
    const turns: Turn[] = this.activeChatId ? this.chatStore.loadTranscript(this.activeChatId) : [];
    const inFlight = this.activeChatId ? this.inFlightChats.has(this.activeChatId) : false;
    this.view.webview.postMessage({ type: 'state', state: { chats, activeChatId: this.activeChatId, turns, inFlight } });
  }

  private renderHtml(webview: vscode.Webview): string {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'main.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'styles.css'));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const html = readFileSync(join(this.extensionUri.fsPath, 'dist', 'webview', 'index.html'), 'utf8');
    return html
      .replace(/\$\{cspSource\}/g, webview.cspSource)
      .replace(/\$\{nonce\}/g, nonce)
      .replace(/\$\{scriptUri\}/g, scriptUri.toString())
      .replace(/\$\{stylesUri\}/g, stylesUri.toString());
  }
}
