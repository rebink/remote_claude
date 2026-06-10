import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveCli } from '../cli/resolveCli.ts';
import { detectProjectType } from './detectProjectType.ts';
import { EXCLUDE_TEMPLATES, PROJECT_TYPES, type ProjectType } from './syncTemplates.ts';

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
  workspaceFolder?: string;
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
      'patchwire.setup',
      'Patchwire — Setup',
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
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.state = { ...this.state, workspaceFolder: wsFolder };
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
          const inv = resolveCli(this.extensionUri.fsPath);
          const r = cp.spawnSync(inv.command, [...inv.baseArgs, 'setup', '--list-peers', '--json'], { encoding: 'utf8', env: inv.env });
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
      case 'openKeyInstallTerminal': {
        const host = this.state.host;
        const user = (msg.user as string) || this.state.user;
        const sshPort = this.state.sshPort ?? 22;
        if (!host || !user) {
          this.state = { ...this.state, error: 'Host and username are required (go back to Step 1).' };
          return this.postState();
        }
        const os = await import('node:os');
        const path = await import('node:path');
        const keysDir = path.join(os.homedir(), '.patchwire', 'keys');
        const keyPath = path.join(keysDir, `${host}-${user}`);
        this.state = { ...this.state, user, keyPath, error: undefined };
        this.postState();

        const cmd =
          `mkdir -p '${keysDir}' && ` +
          `([ -f '${keyPath}' ] || ssh-keygen -t ed25519 -N '' -C patchwire -f '${keyPath}') && ` +
          `ssh-copy-id -i '${keyPath}.pub' -p ${sshPort} ${user}@${host}`;
        const terminal = vscode.window.createTerminal({ name: 'Patchwire: install key' });
        terminal.show();
        terminal.sendText(cmd);
        return;
      }
      case 'verifyKey': {
        const host = this.state.host;
        const user = (msg.user as string) || this.state.user;
        const sshPort = this.state.sshPort ?? 22;
        const keyPath = this.state.keyPath;
        if (!host || !user || !keyPath) {
          this.state = { ...this.state, error: 'Open the terminal and install the key first.' };
          return this.postState();
        }
        this.state = { ...this.state, busy: true, error: undefined };
        this.postState();

        const cp = await import('node:child_process');
        const inv = resolveCli(this.extensionUri.fsPath);
        const args = ['setup', '--verify-key', '--host', host, '--user', user, '--ssh-port', String(sshPort), '--key-path', keyPath];
        const child = cp.spawn(inv.command, [...inv.baseArgs, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: inv.env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
        child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
        const outcome = await new Promise<{ error: Error | null; code: number | null }>((resolve) => {
          let settled = false;
          child.on('error', (err: Error) => { if (!settled) { settled = true; resolve({ error: err, code: null }); } });
          child.on('close', (code) => { if (!settled) { settled = true; resolve({ error: null, code }); } });
        });

        if (stdout.trim()) this.output.appendLine(`[verify-key] ${stdout.trim()}`);
        if (stderr.trim()) this.output.appendLine(`[verify-key stderr] ${stderr.trim()}`);
        this.output.appendLine(`[verify-key] exit ${outcome.code ?? 'null'}`);

        let result: { ok: boolean; code?: string; stderr?: string };
        if (outcome.error) {
          result = { ok: false, code: 'spawn_failed', stderr: `Failed to spawn patchwire: ${outcome.error.message}. Is it on PATH?` };
        } else {
          try {
            const parsed = JSON.parse(stdout.trim() || '{}') as { ok?: unknown; code?: string; stderr?: string };
            if (typeof parsed.ok !== 'boolean') throw new Error('no usable result');
            result = parsed as { ok: boolean; code?: string; stderr?: string };
          } catch {
            result = { ok: false, code: 'unknown', stderr: stderr.trim() || `verify exited ${outcome.code ?? 'null'} with no output.` };
          }
        }

        this.state = { ...this.state, busy: false };
        if (result.ok) this.state = { ...this.state, step: 3, error: undefined };
        this.panel?.webview.postMessage({ type: 'step2Result', result });
        this.postState();
        return;
      }
      case 'detectProjectType': {
        const lp = (msg.localPath as string) ?? '';
        const os = await import('node:os');
        const path = await import('node:path');
        const expanded = lp.startsWith('~') ? path.join(os.homedir(), lp.slice(1)) : lp;
        const projectType: ProjectType = expanded ? detectProjectType(expanded) : 'common';
        this.panel?.webview.postMessage({ type: 'detectedProjectType', projectType });
        return;
      }
      case 'step3Submit': {
        const localPath = msg.localPath as string;
        const projectName = msg.projectName as string;
        const overwrite = !!msg.overwrite;
        const useExisting = !!msg.useExisting;
        const { host, user, sshPort = 22 } = this.state;
        const projectType: ProjectType = PROJECT_TYPES.includes(msg.projectType as ProjectType)
          ? (msg.projectType as ProjectType)
          : 'common';

        if (!localPath || !projectName || !host || !user) {
          this.state = { ...this.state, error: 'Local folder and project name are required' };
          return this.postState();
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(projectName) || /^\.+$/.test(projectName)) {
          this.state = {
            ...this.state,
            error: 'Project name must match [a-zA-Z0-9._-]+ and cannot be "." or ".."',
          };
          return this.postState();
        }

        this.state = { ...this.state, busy: true, error: undefined, projectName, localPath };
        this.postState();

        const cp = await import('node:child_process');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const os = await import('node:os');
        const crypto = await import('node:crypto');
        const { stringify } = await import('yaml');

        const expandedLocalPath = localPath.startsWith('~')
          ? path.join(os.homedir(), localPath.slice(1))
          : localPath;

        // 1. Ensure local folder exists
        if (!fs.existsSync(expandedLocalPath) || !fs.statSync(expandedLocalPath).isDirectory()) {
          this.state = { ...this.state, busy: false, error: `Local folder does not exist: ${expandedLocalPath}` };
          return this.postState();
        }

        // 2. Generate or reuse the agent token
        const envPath = path.join(os.homedir(), '.patchwire', 'env');
        let token: string;
        if (fs.existsSync(envPath)) {
          const envText = fs.readFileSync(envPath, 'utf8');
          const match = envText.match(/^PW_TOKEN=(.+)$/m);
          token = match ? match[1] : crypto.randomBytes(32).toString('hex');
        } else {
          token = crypto.randomBytes(32).toString('hex');
          fs.mkdirSync(path.dirname(envPath), { recursive: true });
          fs.writeFileSync(envPath, `PW_TOKEN=${token}\n`, { mode: 0o600 });
          this.output.appendLine(
            `Generated agent token at ${envPath} (mode 0600). ` +
              `Set PW_AGENT_TOKEN=${token} on the Mac Mini's launchd agent for it to take effect.`,
          );
        }

        // Namespace the remote path under the LAPTOP's username so multiple
        // developers sharing one SSH account on the remote don't collide on
        // project names. Fallback to "shared" if local username is unusable
        // (e.g., contains weird chars). Example: ~/workspace/alice/my-app.
        const rawLocalUser = (os.userInfo().username || 'shared').toLowerCase();
        const localUser = rawLocalUser.replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'shared';
        const remotePathOnMini = `~/workspace/${localUser}/${projectName}`;

        // 3. Write patchwire.yml in the local folder
        const yamlPath = path.join(expandedLocalPath, 'patchwire.yml');
        try {
          fs.writeFileSync(
            yamlPath,
            stringify({
              project: projectName,
              remote: {
                host,
                user,
                sshPort,
                path: remotePathOnMini,
                agentUrl: `http://${host}:7878`,
                token: '${PW_TOKEN}',
              },
              sync: { exclude: EXCLUDE_TEMPLATES[projectType] },
              ai: { command: 'claude', args: ['--print'], timeoutSec: 600 },
            }),
          );
        } catch (err) {
          this.state = { ...this.state, busy: false };
          this.panel?.webview.postMessage({
            type: 'step3Result',
            result: { ok: false, where: 'local', stderr: `Failed to write patchwire.yml: ${(err as Error).message}` },
          });
          return this.postState();
        }

        // 4. Spawn `patchwire init-remote --from-local --json` and stream NDJSON
        this.output.appendLine(`Pushing ${expandedLocalPath} → ${remotePathOnMini}…`);
        const args = ['init-remote', '--from-local', '--project', projectName, '--host', host, '--user', user, '--ssh-port', String(sshPort), '--remote-path', remotePathOnMini, '--json'];
        if (overwrite) args.push('--overwrite');
        if (useExisting) args.push('--use-existing');

        const inv = resolveCli(this.extensionUri.fsPath);
        const child = cp.spawn(inv.command, [...inv.baseArgs, ...args], { cwd: expandedLocalPath, stdio: ['ignore', 'pipe', 'pipe'], env: inv.env });
        let stdoutBuf = '';
        let stderrBuf = '';
        let lastFailure: { code?: string; stderr?: string; name?: string } | undefined;
        let doneOk = false;

        child.stdout.on('data', (c: Buffer) => {
          stdoutBuf += c.toString();
          let nl: number;
          while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
            const line = stdoutBuf.slice(0, nl).trim();
            stdoutBuf = stdoutBuf.slice(nl + 1);
            if (!line) continue;
            try {
              const evt = JSON.parse(line) as { type: string; [k: string]: unknown };
              this.output.appendLine(`[init-remote] ${line}`);
              // Forward progress + step events to the webview
              this.panel?.webview.postMessage({ type: 'step3Event', event: evt });
              if (evt.type === 'step' && evt.status === 'fail') {
                lastFailure = { code: evt.code as string, stderr: evt.stderr as string, name: evt.name as string };
              }
              if (evt.type === 'done') doneOk = evt.ok === true;
            } catch {
              this.output.appendLine(`[init-remote] (non-JSON) ${line}`);
            }
          }
        });
        child.stderr.on('data', (c: Buffer) => {
          stderrBuf += c.toString();
          this.output.appendLine(`[init-remote stderr] ${c.toString()}`);
        });

        const exit: number | null = await new Promise((resolve) => {
          let settled = false;
          child.on('error', (err) => {
            if (settled) return;
            settled = true;
            this.output.appendLine(`Failed to spawn patchwire: ${err.message}. Is it on PATH?`);
            resolve(null);
          });
          child.on('close', (code) => {
            if (settled) return;
            settled = true;
            resolve(code);
          });
        });

        this.state = { ...this.state, busy: false };

        if (doneOk && exit === 0) {
          this.panel?.webview.postMessage({ type: 'step3Result', result: { ok: true } });
          this.state = { ...this.state, step: 4 };
          return this.postState();
        }

        // Handle target_exists with a modal asking overwrite / use-existing / cancel
        if (lastFailure?.code === 'target_exists') {
          const choice = await vscode.window.showWarningMessage(
            `${remotePathOnMini} already exists on the Mac Mini.`,
            { modal: true },
            'Overwrite (rm -rf + re-push)',
            'Use existing (skip rsync)',
          );
          if (choice === 'Overwrite (rm -rf + re-push)') {
            return this.handleMessage({ ...msg, overwrite: true });
          }
          if (choice === 'Use existing (skip rsync)') {
            return this.handleMessage({ ...msg, useExisting: true });
          }
          // Cancel: leave wizard on Step 3
          this.panel?.webview.postMessage({
            type: 'step3Result',
            result: { ok: false, where: 'remote', stderr: 'Cancelled: target exists on remote.' },
          });
          return this.postState();
        }

        this.panel?.webview.postMessage({
          type: 'step3Result',
          result: {
            ok: false,
            where: 'remote',
            stderr: (lastFailure?.stderr ?? stderrBuf ?? `init-remote exited with code ${exit}`).slice(0, 500),
          },
        });
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
          const inv = resolveCli(this.extensionUri.fsPath);
          const child = cp.spawn(inv.command, [...inv.baseArgs, 'doctor'], { cwd: expandedLocalPath, env: inv.env });
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
              stderr: `Failed to spawn patchwire: ${err.message}. Is it on PATH?`,
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
        // Reload the window so the extension reactivates and picks up the new patchwire.yml.
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
