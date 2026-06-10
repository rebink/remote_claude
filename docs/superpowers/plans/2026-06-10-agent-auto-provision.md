# Auto-provision the patchwire-agent over SSH — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After key install + project push, the setup wizard auto-provisions the remote `patchwire-agent` over SSH (install if missing, start it bound to a reachable host, set the token both ends, wait for `/health`) with no manual steps — non-blocking if it can't finish.

**Architecture:** A new CLI mode `setup --provision-agent` (laptop-side orchestrator) drives an SSH login-shell install; `patchwire-agent install` is hardened to start reliably over SSH; the wizard calls the mode after the push step.

**Tech Stack:** TypeScript, commander CLI, undici, VS Code extension API, vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-agent-auto-provision-design.md`

**Commands:** CLI test `pnpm --filter @rebink/patchwire exec vitest run <p>`; extension test `pnpm --filter patchwire-vscode exec vitest run <p>`; typecheck/build per package.

---

## File structure

- Modify: `packages/cli/src/commands/daemon.ts` — harden launchd start (bootstrap → load → kickstart); export a testable `startLaunchAgent`.
- Create: `packages/cli/test/commands/daemon-start.test.ts`
- Modify: `packages/cli/src/commands/setup.ts` — add `runProvisionAgent` + helpers `writeLocalToken`, `pollAgentHealth`.
- Modify: `packages/cli/src/cli.ts` — add `--provision-agent` / `--agent-port` options + dispatch.
- Create: `packages/cli/test/commands/setup-provision-agent.test.ts`
- Modify: `packages/extension/src/setup/SetupWizard.ts` — provision after the push step (non-blocking).
- Modify: `packages/extension/src/setup/SetupWizard.test.ts` — test the provision call.
- Modify: `packages/extension/src/setup/webview/main.ts` — show provisioning progress in the wizard.

---

## Task 1: Harden the launchd start (`daemon.ts`)

**Files:** Modify `src/commands/daemon.ts`; create `test/commands/daemon-start.test.ts`.

- [ ] **Step 1: Write the failing test** — `packages/cli/test/commands/daemon-start.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cp from 'node:child_process';
import { startLaunchAgent } from '../../src/commands/daemon.ts';

afterEach(() => vi.restoreAllMocks());

describe('startLaunchAgent', () => {
  it('uses bootstrap when it succeeds', () => {
    const spy = vi.spyOn(cp, 'spawnSync').mockImplementation((_c, args) =>
      (args as string[])[0] === 'bootstrap' ? { status: 0, stdout: '', stderr: '' } as never
                                            : { status: 0, stdout: '', stderr: '' } as never);
    const r = startLaunchAgent('/tmp/x.plist', 501);
    expect(r.ok).toBe(true);
    expect(r.method).toBe('bootstrap');
  });
  it('falls back to load when bootstrap fails', () => {
    vi.spyOn(cp, 'spawnSync').mockImplementation((_c, args) => {
      const a = args as string[];
      if (a[0] === 'bootstrap') return { status: 5, stdout: '', stderr: 'Bootstrap failed' } as never;
      if (a[0] === 'load') return { status: 0, stdout: '', stderr: '' } as never;
      return { status: 0, stdout: '', stderr: '' } as never;
    });
    const r = startLaunchAgent('/tmp/x.plist', 501);
    expect(r.ok).toBe(true);
    expect(r.method).toBe('load');
  });
  it('reports failure with stderr when nothing starts it', () => {
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 5, stdout: '', stderr: 'Input/output error' } as never);
    const r = startLaunchAgent('/tmp/x.plist', 501);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/Input\/output error/);
  });
});
```

- [ ] **Step 2: Run it, confirm fail** (`pnpm --filter @rebink/patchwire exec vitest run test/commands/daemon-start.test.ts`).

- [ ] **Step 3: Implement.** In `daemon.ts`, add an exported helper and use it. The label const is `SERVICE_LABEL`.

```ts
/**
 * Start (or restart) the LaunchAgent. Tries the modern GUI-domain `bootstrap`
 * first (this is what works over SSH when the user is logged in), then the
 * legacy `load`, then `kickstart`. Returns how it started, or a failure.
 */
export function startLaunchAgent(plist: string, uid: number): { ok: boolean; method?: string; stderr?: string } {
  const domain = `gui/${uid}`;
  // Clear any prior registration both ways (ignore errors).
  spawnSync('launchctl', ['bootout', `${domain}/${SERVICE_LABEL}`], { stdio: 'ignore' });
  spawnSync('launchctl', ['unload', plist], { stdio: 'ignore' });

  const boot = spawnSync('launchctl', ['bootstrap', domain, plist], { encoding: 'utf8' });
  if (boot.status === 0) {
    spawnSync('launchctl', ['kickstart', '-k', `${domain}/${SERVICE_LABEL}`], { stdio: 'ignore' });
    return { ok: true, method: 'bootstrap' };
  }
  const load = spawnSync('launchctl', ['load', plist], { encoding: 'utf8' });
  if (load.status === 0) return { ok: true, method: 'load' };

  const stderr = (boot.stderr || load.stderr || 'launchctl could not start the agent').trim();
  return { ok: false, stderr };
}
```

Then in `runDaemonInstall`, replace the existing `spawnSync('launchctl', ['unload', …])` + `spawnSync('launchctl', ['load', …])` + the `if (load.status !== 0)` block with:

```ts
  const uid = process.getuid?.() ?? 0;
  const start = startLaunchAgent(plistPath(), uid);
  if (!start.ok) {
    log.err(`launchctl could not start the agent: ${start.stderr}`);
    log.err(`The plist is written. If this remote is logged in, run: launchctl bootstrap gui/${uid} ${plistPath()}`);
    process.exitCode = 1;
    return;
  }
```

- [ ] **Step 4: Run tests + typecheck** (the new test + full CLI suite) — PASS. Update any existing daemon test that asserted the old `load` call.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): start the agent via launchctl bootstrap (reliable over ssh)"`

---

## Task 2: CLI `setup --provision-agent`

**Files:** Modify `src/commands/setup.ts`, `src/cli.ts`; create `test/commands/setup-provision-agent.test.ts`.

- [ ] **Step 1: Write the failing test** — `packages/cli/test/commands/setup-provision-agent.test.ts` (mirror the style of `setup-verify-key.test.ts`; mock `node:child_process`, `node:fs`, and `undici`):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';

vi.mock('node:child_process');
vi.mock('undici', () => ({ fetch: vi.fn(async () => ({ ok: true })) }));

afterEach(() => vi.restoreAllMocks());

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const writes: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;
  return fn().finally(() => { process.stdout.write = orig; }).then(() => writes.join(''));
}

describe('setup --provision-agent', () => {
  it('ssh-installs via a login shell, writes the token, and reports healthy', async () => {
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 0, stdout: '', stderr: '' } as never);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as never);
    const wf = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined as never);
    vi.spyOn(fs, 'chmodSync').mockReturnValue(undefined as never);
    const { runProvisionAgent } = await import('../../src/commands/setup.ts');

    const out = await captureStdout(() => runProvisionAgent({
      host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: 'abc',
    }));

    expect(JSON.parse(out)).toEqual({ ok: true, healthy: true });
    const sshArgs = (cp.spawnSync as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as string[];
    expect(sshArgs.join(' ')).toMatch(/bash -lc/);
    expect(sshArgs.join(' ')).toMatch(/patchwire-agent install --token abc --host h --port 7878/);
    expect(sshArgs).toEqual(expect.arrayContaining(['-o', 'IdentitiesOnly=yes']));
    // token written to ~/.patchwire/env
    expect(wf.mock.calls.some((c) => String(c[0]).endsWith('.patchwire/env') && String(c[1]).includes('PW_TOKEN=abc'))).toBe(true);
  });

  it('maps a missing remote Node to code no_node', async () => {
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 3, stdout: 'PW_NO_NODE\n', stderr: '' } as never);
    const { runProvisionAgent } = await import('../../src/commands/setup.ts');
    const out = await captureStdout(() => runProvisionAgent({ host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: 'abc' }));
    expect(JSON.parse(out).code).toBe('no_node');
  });
});
```

- [ ] **Step 2: Run it, confirm fail.**

- [ ] **Step 3: Implement.** In `setup.ts` add (top-of-file imports already include `spawnSync`, `fs`/`existsSync`, `homedir`, `join`, `dirname` — add any missing):

```ts
export interface ProvisionAgentInput {
  host: string;
  user: string;
  port: number;       // ssh port
  keyPath: string;
  agentPort: number;  // agent HTTP port
  token: string;
}

function writeLocalToken(token: string): void {
  const envPath = join(homedir(), '.patchwire', 'env');
  fs.mkdirSync(dirname(envPath), { recursive: true });
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  if (/^PW_TOKEN=.*$/m.test(content)) content = content.replace(/^PW_TOKEN=.*$/m, `PW_TOKEN=${token}`);
  else content = (content && !content.endsWith('\n') ? content + '\n' : content) + `PW_TOKEN=${token}\n`;
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

async function pollAgentHealth(host: string, port: number): Promise<boolean> {
  const { fetch } = await import('undici');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/health`, { method: 'GET' });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Install + start the remote agent over the per-project key, set the token on the
 * laptop, and wait for /health. Prints a single JSON result to stdout.
 */
export async function runProvisionAgent(input: ProvisionAgentInput): Promise<void> {
  const remoteScript = [
    'set -e',
    'command -v node >/dev/null || { echo PW_NO_NODE; exit 3; }',
    'command -v patchwire-agent >/dev/null || npm i -g @rebink/patchwire >/dev/null 2>&1',
    `patchwire-agent install --token ${input.token} --host ${input.host} --port ${input.agentPort}`,
  ].join('; ');
  const remoteCmd = `bash -lc '${remoteScript.replace(/'/g, `'\\''`)}'`;

  const ssh = spawnSync('ssh', [
    '-i', input.keyPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    '-p', String(input.port),
    `${input.user}@${input.host}`,
    remoteCmd,
  ], { encoding: 'utf8' });

  const stdout = ssh.stdout ?? '';
  const stderr = (ssh.stderr ?? '').trim();

  if (stdout.includes('PW_NO_NODE')) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'no_node', stderr: 'Node 20+ was not found on the remote. Install Node there, then re-run setup.' }));
    return;
  }
  if (ssh.status !== 0) {
    const code = /launchctl|bootstrap|could not start/i.test(stderr) ? 'launchd_unstarted' : 'install_failed';
    writeLocalToken(input.token); // so a manual start still authenticates
    process.stdout.write(JSON.stringify({ ok: false, code, stderr: stderr || `provision exited ${ssh.status ?? 'null'}` }));
    return;
  }

  writeLocalToken(input.token);
  const healthy = await pollAgentHealth(input.host, input.agentPort);
  process.stdout.write(JSON.stringify(healthy ? { ok: true, healthy: true } : { ok: false, code: 'unhealthy', healthy: false }));
}
```

In `cli.ts` `setup` command: add options
```ts
  .option('--provision-agent', 'install + start the remote agent and set the token (used by the wizard)')
  .option('--agent-port <n>', 'agent HTTP port', (v: string) => Number(v))
```
and in the action, after the `--verify-key` block, add:
```ts
    if (opts.provisionAgent) {
      const { runProvisionAgent } = await import('./commands/setup.ts');
      await runProvisionAgent({
        host: opts.host,
        user: opts.user,
        port: opts.sshPort ?? 22,
        keyPath: opts.keyPath,
        agentPort: opts.agentPort ?? 7878,
        token: opts.token,
      });
      return;
    }
```

- [ ] **Step 4: Run tests + typecheck.** New test passes; full CLI suite passes.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): setup --provision-agent (install + start remote agent, set token)"`

---

## Task 3: Wizard host — provision after push

**Files:** Modify `src/setup/SetupWizard.ts`, `src/setup/SetupWizard.test.ts`.

- [ ] **Step 1: Write the failing test.** In `SetupWizard.test.ts`, mirroring the existing harness, add a test that after a successful `step3Submit` push (spawn returns `{ok:true}` JSON), the wizard ALSO spawns the bundled CLI with `setup --provision-agent` and a generated `--token`, and that a provisioning failure does NOT prevent reaching step 4:

```ts
it('provisions the agent after a successful push, non-blocking on failure', async () => {
  // push (init-remote) succeeds, then provision returns a failure JSON
  // (use the existing makeChild/spawnCalls harness; queue two child results)
  // ... drive step3Submit ...
  const provision = spawnCalls.find((c) => c.args.includes('--provision-agent'));
  expect(provision).toBeTruthy();
  expect(provision!.args.join(' ')).toMatch(/--token \w+/);
  // wizard still advanced to step 4 despite provision failure
});
```

(Follow the file's existing wizard construction + `spawnCalls`/`makeChild` queueing. If the harness only stubs one child, extend it to return the push result then the provision result.)

- [ ] **Step 2: Run it, confirm fail.**

- [ ] **Step 3: Implement.** Add a private method and call it from the `step3Submit` success path (right after the push `init-remote` succeeds and `patchwire.yml` is written, before advancing to step 4):

```ts
  private async provisionAgent(host: string, user: string, sshPort: number, keyPath: string, agentPort: number): Promise<void> {
    const crypto = await import('node:crypto');
    const cp = await import('node:child_process');
    const token = crypto.randomBytes(32).toString('hex');
    this.panel?.webview.postMessage({ type: 'provisionStatus', text: 'Installing the agent on the remote…' });

    const inv = resolveCli(this.extensionUri.fsPath);
    const args = ['setup', '--provision-agent', '--host', host, '--user', user, '--ssh-port', String(sshPort),
      '--key-path', keyPath, '--agent-port', String(agentPort), '--token', token];
    const child = cp.spawn(inv.command, [...inv.baseArgs, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: inv.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    await new Promise<void>((resolve) => { child.on('error', () => resolve()); child.on('close', () => resolve()); });

    if (stdout.trim()) this.output.appendLine(`[provision] ${stdout.trim()}`);
    if (stderr.trim()) this.output.appendLine(`[provision stderr] ${stderr.trim()}`);

    let result: { ok?: boolean; code?: string; stderr?: string } = {};
    try { result = JSON.parse(stdout.trim() || '{}'); } catch { /* leave empty */ }
    const text = result.ok
      ? '✓ Agent provisioned.'
      : `Agent not provisioned (${result.code ?? 'error'}): ${result.stderr ?? 'see output channel'}. The extension still works without it.`;
    this.panel?.webview.postMessage({ type: 'provisionStatus', text });
  }
```

Call it from the step3 success path with the config values (host/user/sshPort/keyPath from state, agentPort parsed from the configured agentUrl or 7878). Provisioning is awaited but its failure never blocks: after it returns, advance to step 4 exactly as today.

- [ ] **Step 4: Run tests + typecheck + full extension suite.**
- [ ] **Step 5: Commit** — `git commit -m "feat(extension): auto-provision the agent after the push step (non-blocking)"`

---

## Task 4: Webview — provisioning progress

**Files:** Modify `src/setup/webview/main.ts`. Manual verify (typecheck + build + render note).

- [ ] **Step 1:** Add a module-level `let provisionStatus = '';`, handle the new message in the `window` message listener:
```ts
  } else if (msg.type === 'provisionStatus' && typeof (msg as { text?: string }).text === 'string') {
    provisionStatus = (msg as { text: string }).text;
    render();
  }
```
- [ ] **Step 2:** In `renderStep3` (and/or step 4), render `provisionStatus` when non-empty as a `<p class="note">`. Keep it informational; it never blocks navigation.
- [ ] **Step 3:** `pnpm --filter patchwire-vscode typecheck` clean; `pnpm --filter patchwire-vscode build` success.
- [ ] **Step 4:** Render note (PR): after the push, the wizard shows "Installing the agent on the remote…" then "✓ Agent provisioned" or a clear non-blocking failure line.
- [ ] **Step 5: Commit** — `git commit -m "feat(extension): show agent provisioning status in the wizard"`

---

## Final verification

- [ ] `pnpm --filter @rebink/patchwire test` and `pnpm --filter patchwire-vscode test` pass; both typecheck clean; `pnpm --filter patchwire-vscode build` clean (vsix self-contained).
- [ ] `git diff --stat main...HEAD` touches only the planned files + spec/plan.
