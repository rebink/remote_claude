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

        const spawnError = await new Promise<Error | null>((resolve) => {
          let settled = false;
          child.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            resolve(err);
          });
          child.on('close', () => {
            if (settled) return;
            settled = true;
            resolve(null);
          });
        });

        let result: { ok: boolean; code?: string; stderr?: string };
        if (spawnError) {
          result = { ok: false, code: 'spawn_failed', stderr: `Failed to spawn remote-claude: ${spawnError.message}. Is it on PATH?` };
        } else {
          try {
            result = JSON.parse(stdout || '{"ok":false,"code":"unknown"}');
          } catch {
            result = { ok: false, code: 'unknown', stderr: stderr || stdout };
          }
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
      case 'step3Submit': {
        const gitUrl = msg.gitUrl as string;
        const branch = (msg.branch as string) || 'main';
        const projectName = msg.projectName as string;
        const localPath = msg.localPath as string;
        const { host, user, sshPort = 22 } = this.state;

        if (!gitUrl || !projectName || !localPath || !host || !user) {
          this.state = { ...this.state, error: 'Git URL, project name, and local path are required' };
          return this.postState();
        }

        this.state = { ...this.state, busy: true, error: undefined, gitUrl, branch, projectName, localPath };
        this.postState();

        const cp = await import('node:child_process');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const os = await import('node:os');
        const crypto = await import('node:crypto');
        const { stringify } = await import('yaml');

        // Expand a leading "~" in the user-supplied local path.
        const expandedLocalPath = localPath.startsWith('~')
          ? path.join(os.homedir(), localPath.slice(1))
          : localPath;

        // 1. Local clone
        this.output.appendLine(`Cloning ${gitUrl} into ${expandedLocalPath}…`);
        let localClone;
        try {
          localClone = cp.spawnSync('git', ['clone', '-b', branch, '--', gitUrl, expandedLocalPath], { encoding: 'utf8' });
        } catch (err) {
          this.state = { ...this.state, busy: false };
          this.panel?.webview.postMessage({
            type: 'step3Result',
            result: { ok: false, where: 'local', stderr: `Failed to spawn git: ${(err as Error).message}` },
          });
          return this.postState();
        }
        if (localClone.error) {
          this.state = { ...this.state, busy: false };
          this.panel?.webview.postMessage({
            type: 'step3Result',
            result: { ok: false, where: 'local', stderr: `Failed to spawn git: ${localClone.error.message}` },
          });
          return this.postState();
        }
        if (localClone.status !== 0) {
          this.state = { ...this.state, busy: false };
          this.panel?.webview.postMessage({
            type: 'step3Result',
            result: { ok: false, where: 'local', stderr: String(localClone.stderr ?? '').slice(0, 500) },
          });
          return this.postState();
        }

        // 2. Generate (or reuse) an agent token and write it to ~/.remote-claude/env.
        // The dev must set RC_AGENT_TOKEN on the remote agent to this same value.
        const envPath = path.join(os.homedir(), '.remote-claude', 'env');
        let token: string;
        if (fs.existsSync(envPath)) {
          const envText = fs.readFileSync(envPath, 'utf8');
          const match = envText.match(/^RC_TOKEN=(.+)$/m);
          token = match ? match[1] : crypto.randomBytes(32).toString('hex');
        } else {
          token = crypto.randomBytes(32).toString('hex');
          fs.mkdirSync(path.dirname(envPath), { recursive: true });
          fs.writeFileSync(envPath, `RC_TOKEN=${token}\n`, { mode: 0o600 });
          this.output.appendLine(
            `Generated agent token at ${envPath} (mode 0600). ` +
              `Set RC_AGENT_TOKEN=${token} on the Mac Mini's launchd agent for it to take effect.`,
          );
        }

        // 3. Write remote-claude.yml in the local path
        const yamlPath = path.join(expandedLocalPath, 'remote-claude.yml');
        try {
          fs.writeFileSync(
            yamlPath,
            stringify({
              project: projectName,
              remote: {
                host,
                user,
                sshPort,
                path: `~/workspace/${projectName}`,
                agentUrl: `http://${host}:7878`,
                token: '${RC_TOKEN}',
              },
              sync: { exclude: ['build/', '.dart_tool/', 'ios/Pods/', 'node_modules/', '.git/'] },
              ai: { command: 'claude', args: ['--print'], timeoutSec: 600 },
            }),
          );
        } catch (err) {
          this.state = { ...this.state, busy: false };
          this.panel?.webview.postMessage({
            type: 'step3Result',
            result: { ok: false, where: 'local', stderr: `Failed to write remote-claude.yml: ${(err as Error).message}` },
          });
          return this.postState();
        }

        // 4. Remote clone via init-remote (CLI calls the agent's POST /init)
        this.output.appendLine(`Cloning remote into ~/workspace/${projectName}…`);
        let initRemote;
        try {
          initRemote = cp.spawnSync(
            'remote-claude',
            ['init-remote', '--git-url', gitUrl, '--branch', branch, '--project', projectName],
            { cwd: expandedLocalPath, encoding: 'utf8' },
          );
        } catch (err) {
          this.state = { ...this.state, busy: false };
          this.panel?.webview.postMessage({
            type: 'step3Result',
            result: { ok: false, where: 'remote', stderr: `Failed to spawn remote-claude: ${(err as Error).message}. Is it on PATH?` },
          });
          return this.postState();
        }

        this.state = { ...this.state, busy: false };

        if (initRemote.error) {
          this.panel?.webview.postMessage({
            type: 'step3Result',
            result: { ok: false, where: 'remote', stderr: `Failed to spawn remote-claude: ${initRemote.error.message}. Is it on PATH?` },
          });
          return this.postState();
        }
        if (initRemote.status !== 0) {
          this.panel?.webview.postMessage({
            type: 'step3Result',
            result: { ok: false, where: 'remote', stderr: String(initRemote.stderr ?? '').slice(0, 500) },
          });
          return this.postState();
        }

        this.state = { ...this.state, step: 4, error: undefined };
        this.panel?.webview.postMessage({ type: 'step3Result', result: { ok: true } });
        this.postState();
        return;
      }
      case 'step4Run': {
        const { localPath } = this.state;
        if (!localPath) {
          this.panel?.webview.postMessage({
            type: 'step4Result',
            result: { ok: false, stdout: '', stderr: 'No local path set' },
          });
          return;
        }
        this.state = { ...this.state, busy: true };
        this.postState();

        const cp = await import('node:child_process');
        const os = await import('node:os');
        const path = await import('node:path');

        // Expand a leading "~" in the user-supplied local path so the doctor
        // cwd is a real path, not a literal "~/...".
        const expandedLocalPath = localPath.startsWith('~')
          ? path.join(os.homedir(), localPath.slice(1))
          : localPath;

        const r = await new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
          const child = cp.spawn('remote-claude', ['doctor'], { cwd: expandedLocalPath });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
          child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
          let settled = false;
          child.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            resolve({
              ok: false,
              stdout: '',
              stderr: `Failed to spawn remote-claude: ${err.message}. Is it on PATH?`,
            });
          });
          child.on('close', (code) => {
            if (settled) return;
            settled = true;
            resolve({ ok: code === 0, stdout, stderr });
          });
        });

        this.state = { ...this.state, busy: false };
        this.panel?.webview.postMessage({ type: 'step4Result', result: r });
        this.postState();
        return;
      }
      case 'step4Finish': {
        this.panel?.dispose();
        // Reload the window so the extension reactivates and picks up the new remote-claude.yml.
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
        return;
      }
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
