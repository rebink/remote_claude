import * as vscode from 'vscode';
import type { SyncController } from './sync/SyncController.ts';
import type { StatusBarController } from './statusbar/StatusBarController.ts';
import type { SetupWizard } from './setup/SetupWizard.ts';
import type { ChatPanel } from './chat/ChatPanel.ts';

export interface ExtensionDeps {
  output: vscode.OutputChannel;
  sync: SyncController;
  status: StatusBarController;
  setupWizard: SetupWizard;
  panel: ChatPanel;
}

export function registerCommands(context: vscode.ExtensionContext, deps: ExtensionDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('remoteClaude.viewOutput', () => deps.output.show()),
    vscode.commands.registerCommand('remoteClaude.openSetup', () => deps.setupWizard.show()),
    vscode.commands.registerCommand('remoteClaude.toggleLiveSync', () => deps.status.toggle()),
    // `newChat` is kept as a command for backward-compat with any user keybindings;
    // it now just opens the Claude session terminal (which IS the new chat).
    vscode.commands.registerCommand('remoteClaude.newChat', () => deps.panel.refresh()),
  );
}
