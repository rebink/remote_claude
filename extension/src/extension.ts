import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Remote Claude');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand('remoteClaude.viewOutput', () => output.show())
  );

  output.appendLine('Remote Claude extension activated.');
}

export function deactivate(): void {}
