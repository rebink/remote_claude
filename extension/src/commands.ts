import * as vscode from 'vscode';
import type { SetupWizard } from './setup/SetupWizard.ts';
import type { ChatPanel } from './chat/ChatPanel.ts';

export interface ExtensionDeps {
  output: vscode.OutputChannel;
  setupWizard: SetupWizard;
  panel: ChatPanel;
}

export function registerCommands(context: vscode.ExtensionContext, deps: ExtensionDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('remoteClaude.viewOutput', () => deps.output.show()),
    vscode.commands.registerCommand('remoteClaude.openSetup', () => deps.setupWizard.show()),
    // Kept for any user keybindings that still reference these — both now
    // just refresh the panel since live-sync is automatic via Mutagen.
    vscode.commands.registerCommand('remoteClaude.toggleLiveSync', () => deps.panel.refresh()),
    vscode.commands.registerCommand('remoteClaude.newChat', () => deps.panel.refresh()),
  );
}
