import * as vscode from 'vscode';
import type { ChatStore } from './chat/ChatStore.ts';
import type { SyncController } from './sync/SyncController.ts';
import type { StatusBarController } from './statusbar/StatusBarController.ts';

export interface ExtensionDeps {
  output: vscode.OutputChannel;
  chatStore: ChatStore;
  sync: SyncController;
  status: StatusBarController;
}

export function registerCommands(context: vscode.ExtensionContext, deps: ExtensionDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('remoteClaude.viewOutput', () => deps.output.show()),
    vscode.commands.registerCommand('remoteClaude.newChat', async () => {
      const title = await vscode.window.showInputBox({ prompt: 'Chat title', value: 'New chat' });
      if (!title) return;
      deps.chatStore.createChat(title);
    }),
    vscode.commands.registerCommand('remoteClaude.openSetup', () =>
      vscode.window.showInformationMessage('Setup wizard arrives in Milestone 5.')
    ),
    vscode.commands.registerCommand('remoteClaude.toggleLiveSync', () => deps.status.toggle()),
  );
}
