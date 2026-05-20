import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface WizardState {
  step: 1 | 2 | 3 | 4;
  host?: string;
  user?: string;
  sshPort?: number;
  keyPath?: string;
  gitUrl?: string;
  branch?: string;
  projectName?: string;
  localPath?: string;
  error?: string;
  busy?: boolean;
}

export class SetupWizard {
  private panel?: vscode.WebviewPanel;
  private state: WizardState = { step: 1 };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
  ) {}

  show(): vscode.WebviewPanel {
    if (this.panel) {
      this.panel.reveal();
      return this.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      'remoteClaude.setup',
      'Remote Claude — Setup',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'setup-webview')],
      }
    );
    this.panel = panel;
    panel.onDidDispose(() => { this.panel = undefined; });
    panel.webview.html = this.renderHtml(panel.webview);
    panel.webview.onDidReceiveMessage((m) => this.handleMessage(m));
    return panel;
  }

  private postState(): void {
    this.panel?.webview.postMessage({ type: 'state', state: this.state });
  }

  private async handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        return this.postState();
      case 'back':
        if (this.state.step > 1) {
          this.state = { ...this.state, step: (this.state.step - 1) as 1 | 2 | 3 | 4, error: undefined };
          return this.postState();
        }
        return;
      case 'step1ListPeers': {
        // One-shot CLI call (not JSONL) — small exception to call spawnSync directly here
        // since the runJsonl helper is for streaming subcommands. See M5.T30.
        try {
          const cp = await import('node:child_process');
          const r = cp.spawnSync('remote-claude', ['setup', '--list-peers', '--json'], { encoding: 'utf8' });
          const peers = r.status === 0 ? JSON.parse(r.stdout || '[]') : [];
          this.panel?.webview.postMessage({ type: 'step1Peers', peers });
        } catch (err) {
          this.output.appendLine(`step1ListPeers failed: ${(err as Error).message}`);
          this.panel?.webview.postMessage({ type: 'step1Peers', peers: [] });
        }
        return;
      }
      case 'step1Submit': {
        const host = msg.host as string;
        const user = msg.user as string;
        const port = (msg.port as number) || 22;
        if (!host || !user) {
          this.state = { ...this.state, error: 'Host and user are required' };
          return this.postState();
        }
        this.state = { ...this.state, host, user, sshPort: port, step: 2, error: undefined };
        return this.postState();
      }
      case 'step2Submit': {
        const { host, sshPort = 22 } = this.state;
        const user = (msg.user as string) || this.state.user;
        const password = msg.password as string;
        const trustNewKey = !!msg.trustNewKey;

        if (!host || !user || !password) {
          this.state = { ...this.state, error: 'Username and password are required' };
          return this.postState();
        }

        // Derive a per-project SSH key path: ~/.remote-claude/keys/<host>-<user>
        const os = await import('node:os');
        const path = await import('node:path');
        const keyPath = path.join(os.homedir(), '.remote-claude', 'keys', `${host}-${user}`);

        this.state = { ...this.state, busy: true, error: undefined, user, keyPath };
        this.postState();

        // Spawn `remote-claude setup --password-stdin --host ... --user ... --ssh-port ... --key-path ... [--trust-new-key]`
        const cp = await import('node:child_process');
        const args = [
          'setup', '--password-stdin',
          '--host', host,
          '--user', user,
          '--ssh-port', String(sshPort),
          '--key-path', keyPath,
        ];
        if (trustNewKey) args.push('--trust-new-key');

        const child = cp.spawn('remote-claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });

        const pwBuf = Buffer.from(password + '\n');
        child.stdin.write(pwBuf);
        child.stdin.end();
        pwBuf.fill(0);

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
        child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

        await new Promise<void>((resolve) => child.on('close', () => resolve()));

        let result: { ok: boolean; code?: string; stderr?: string };
        try {
          result = JSON.parse(stdout || '{"ok":false,"code":"unknown"}');
        } catch {
          result = { ok: false, code: 'unknown', stderr: stderr || stdout };
        }

        this.state = { ...this.state, busy: false };
        if (result.ok) {
          this.state = { ...this.state, step: 3, error: undefined };
        } else {
          this.state = { ...this.state, error: undefined };  // clear; webview will show structured error
        }
        this.panel?.webview.postMessage({ type: 'step2Result', result });
        this.postState();
        return;
      }
      case 'step3Submit':
        // T32 will run the git clone flow.
        this.state = { ...this.state, step: 4 };
        return this.postState();
      case 'step4Finish':
        // T33 will run doctor and then trigger a workspace reload.
        this.panel?.dispose();
        return;
      default:
        this.output.appendLine(`SetupWizard: unknown message type "${msg.type}"`);
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'setup-webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'main.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'styles.css'));
    const nonce = randomBytes(16).toString('base64');
    const html = readFileSync(join(this.extensionUri.fsPath, 'dist', 'setup-webview', 'index.html'), 'utf8');
    return html
      .replace(/\$\{cspSource\}/g, webview.cspSource)
      .replace(/\$\{nonce\}/g, nonce)
      .replace(/\$\{scriptUri\}/g, scriptUri.toString())
      .replace(/\$\{stylesUri\}/g, stylesUri.toString());
  }
}
