import * as vscode from 'vscode';
import { join } from 'node:path';
import { DiffContentProvider, SCHEME } from './diff/DiffContentProvider.ts';
import { ChatStore } from './chat/ChatStore.ts';
import { registerCommands } from './commands.ts';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Remote Claude');
  context.subscriptions.push(output);
  output.appendLine('Remote Claude activated.');

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { output.appendLine('No workspace open — Remote Claude is idle.'); return; }

  const chatStore = new ChatStore(join(ws, '.remote-claude', 'sessions'));
  const diff = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, diff));

  registerCommands(context, { output, chatStore });
}

export function deactivate(): void {}
