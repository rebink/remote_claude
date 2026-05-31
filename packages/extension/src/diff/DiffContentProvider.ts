import * as vscode from 'vscode';
import { spawnSync } from 'node:child_process';

export const SCHEME = 'patchwire';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return '';
    const ref = new URLSearchParams(uri.query).get('ref') ?? 'HEAD';
    const filePath = uri.path.replace(/^\//, '');
    const res = spawnSync('git', ['show', `${ref}:${filePath}`], { cwd, encoding: 'utf8' });
    return res.status === 0 ? res.stdout : '';
  }
}

export function makeBeforeUri(filePath: string): vscode.Uri {
  return vscode.Uri.parse(`${SCHEME}:/${filePath}?ref=HEAD`);
}
