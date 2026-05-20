import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Remote Claude');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand('remoteClaude.viewOutput', () => output.show()),
    vscode.commands.registerCommand('remoteClaude.openSetup', () =>
      vscode.window.showInformationMessage('Setup wizard arrives in Milestone 5.')
    ),
    vscode.commands.registerCommand('remoteClaude.newChat', () =>
      vscode.window.showInformationMessage('Chat panel arrives in Milestone 3.')
    ),
    vscode.commands.registerCommand('remoteClaude.toggleLiveSync', () =>
      vscode.window.showInformationMessage('Live sync arrives in Milestone 4.')
    ),
  );

  output.appendLine('Remote Claude extension activated.');
}

export function deactivate(): void {}
