# Terminal-based key install (drop sshpass) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Install the per-project SSH key via an interactive terminal (`ssh-copy-id`) + a "Verify & continue" check, removing `sshpass` (and its GPL binary) from the project entirely.

**Architecture:** CLI gains `setup --verify-key` (a non-interactive key check) and loses `--password-stdin`/`sshpass`. The wizard host opens a terminal that runs `ssh-keygen`+`ssh-copy-id`, then verifies via the CLI. The webview Step 2 swaps its password field for two buttons.

**Tech Stack:** TypeScript, commander CLI, VS Code extension API, tsup, vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-terminal-key-install-design.md`

**Commands (repo root):** CLI test `pnpm --filter @rebink/patchwire exec vitest run <path>`; extension test `pnpm --filter patchwire-vscode exec vitest run <path>`; typecheck `pnpm --filter <pkg> typecheck`; build `pnpm --filter patchwire-vscode build`.

---

## File structure

- Modify: `packages/cli/src/commands/setup.ts` — add `runVerifyKey`; remove `runSetupPasswordStdin`, `PasswordStdinInput`, `readPasswordFromStdin`, and the `sshpass`/`CopyIdResult` imports.
- Modify: `packages/cli/src/cli.ts` — add `--verify-key`; remove `--password-stdin`/`--trust-new-key` and their dispatch.
- Create: `packages/cli/test/commands/setup-verify-key.test.ts`
- Delete: `packages/cli/src/lib/sshpass.ts`, `packages/cli/test/lib/sshpass.test.ts`, `packages/cli/test/commands/setup-password-stdin.test.ts`, `packages/cli/scripts/fetch-sshpass.sh`, `packages/cli/vendor/sshpass/` (whole dir).
- Modify: `packages/cli/package.json` — remove the `postinstall` script.
- Modify: `packages/extension/src/test/vscode-stub.ts` — add `window.createTerminal`.
- Modify: `packages/extension/src/setup/SetupWizard.ts` — replace `step2Submit` with `openKeyInstallTerminal` + `verifyKey`.
- Modify: `packages/extension/src/setup/SetupWizard.test.ts` — add tests for the new handlers.
- Modify: `packages/extension/src/setup/webview/main.ts` — rebuild `renderStep2`.

---

## Task 1: CLI — `--verify-key` + remove sshpass

**Files:** Modify `src/commands/setup.ts`, `src/cli.ts`, `package.json`; create `test/commands/setup-verify-key.test.ts`; delete the sshpass files.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/commands/setup-verify-key.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cp from 'node:child_process';
import { runVerifyKey } from '../../src/commands/setup.ts';

afterEach(() => vi.restoreAllMocks());

function captureStdout(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;
  try { fn(); } finally { process.stdout.write = orig; }
  return writes.join('');
}

describe('setup --verify-key', () => {
  it('prints { ok: true } when ssh exits 0, using BatchMode', () => {
    const spy = vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 0, stdout: '', stderr: '' } as never);
    const out = captureStdout(() => runVerifyKey({ host: 'h', user: 'u', port: 2222, keyPath: '/k' }));
    expect(JSON.parse(out)).toEqual({ ok: true });
    const args = spy.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(['-o', 'BatchMode=yes', '-i', '/k', '-p', '2222', 'u@h', 'true']));
  });

  it('prints a structured failure when ssh exits non-zero', () => {
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 255, stdout: '', stderr: 'Permission denied (publickey).' } as never);
    const out = captureStdout(() => runVerifyKey({ host: 'h', user: 'u', port: 22, keyPath: '/k' }));
    const r = JSON.parse(out);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('verify_failed');
    expect(r.stderr).toMatch(/Permission denied/);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** (`pnpm --filter @rebink/patchwire exec vitest run test/commands/setup-verify-key.test.ts`) — Expected: `runVerifyKey` not exported.

- [ ] **Step 3: Implement `runVerifyKey` + remove the sshpass path**

In `packages/cli/src/commands/setup.ts`:

(a) Remove the sshpass imports near the top:
```ts
import * as sshpass from '../lib/sshpass.ts';
import type { CopyIdResult } from '../lib/sshpass.ts';
```

(b) Delete `interface PasswordStdinInput { ... }`, `export async function runSetupPasswordStdin(...) { ... }`, and the `function readPasswordFromStdin(): Promise<string> { ... }` helper (all only used by the removed path).

(c) Add the verify command (anywhere among the exports; `spawnSync` is already imported in this file):
```ts
export interface VerifyKeyInput {
  host: string;
  user: string;
  port: number;
  keyPath: string;
}

/**
 * Non-interactive key check used by the wizard's "Verify & continue". With
 * BatchMode the ssh can only succeed when the key is actually installed (no
 * password fallback). Writes `{ ok }` or a structured failure as JSON to stdout.
 */
export function runVerifyKey(input: VerifyKeyInput): void {
  const r = spawnSync(
    'ssh',
    [
      '-i', input.keyPath,
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=6',
      '-p', String(input.port),
      `${input.user}@${input.host}`,
      'true',
    ],
    { encoding: 'utf8' },
  );
  if (r.status === 0) {
    process.stdout.write(JSON.stringify({ ok: true }));
    return;
  }
  const stderr = (r.stderr || r.stdout || `ssh exited ${r.status ?? 'null'}`).trim();
  process.stdout.write(JSON.stringify({ ok: false, code: 'verify_failed', stderr }));
}
```

In `packages/cli/src/cli.ts`:

(d) In the `setup` command options, remove these two lines:
```ts
  .option('--password-stdin', 'read SSH password from stdin and run ssh-copy-id (used by the wizard)')
  .option('--trust-new-key', 'rewrite known_hosts before attempting (used after a fingerprint mismatch confirmation)')
```
and add:
```ts
  .option('--verify-key', 'check that key-based SSH works (used by the wizard)')
```
(keep `--key-path`.)

(e) In the `.action(async (opts) => {`, replace the whole `if (opts.passwordStdin) { ... return; }` block with:
```ts
    if (opts.verifyKey) {
      const { runVerifyKey } = await import('./commands/setup.ts');
      runVerifyKey({
        host: opts.host,
        user: opts.user,
        port: opts.sshPort ?? 22,
        keyPath: opts.keyPath,
      });
      return;
    }
```

- [ ] **Step 4: Delete the sshpass artifacts + postinstall**

```bash
git rm packages/cli/src/lib/sshpass.ts packages/cli/test/lib/sshpass.test.ts packages/cli/test/commands/setup-password-stdin.test.ts packages/cli/scripts/fetch-sshpass.sh
git rm -r packages/cli/vendor/sshpass
```
Then remove the `"postinstall": "bash scripts/fetch-sshpass.sh || true"` line from `packages/cli/package.json`.

- [ ] **Step 5: Run tests + typecheck**

`pnpm --filter @rebink/patchwire exec vitest run test/commands/setup-verify-key.test.ts` → PASS; `pnpm --filter @rebink/patchwire test` → all pass (the deleted tests are gone, nothing references sshpass); `pnpm --filter @rebink/patchwire typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add -A packages/cli
git commit -m "feat(cli): setup --verify-key; remove sshpass + --password-stdin"
```

---

## Task 2: Extension host — terminal install + verify

**Files:** Modify `src/test/vscode-stub.ts`, `src/setup/SetupWizard.ts`, `src/setup/SetupWizard.test.ts`.

- [ ] **Step 1: Add `createTerminal` to the vscode stub.** In `src/test/vscode-stub.ts`, add to the `window` object:
```ts
  createTerminal: (_opts?: unknown) => ({
    name: 'stub',
    sendText: (_t: string) => {},
    show: () => {},
    dispose: () => {},
  }),
```

- [ ] **Step 2: Write the failing tests.** In `src/setup/SetupWizard.test.ts`, mirror the existing test's wizard construction + message-driving pattern, and add:

```ts
it('openKeyInstallTerminal opens a terminal running ssh-copy-id', async () => {
  const sent: string[] = [];
  const vscode = await import('../test/vscode-stub.ts');
  vi.spyOn(vscode.window, 'createTerminal').mockReturnValue({
    name: 't', show: () => {}, dispose: () => {}, sendText: (t: string) => { sent.push(t); },
  } as never);
  // construct the wizard as the existing tests do, set state.host/user/sshPort, then:
  await driveMessage({ type: 'openKeyInstallTerminal', user: 'ana' }); // helper per existing test
  expect(sent.join('\n')).toMatch(/ssh-copy-id .* ana@/);
  expect(sent.join('\n')).toMatch(/ssh-keygen -t ed25519/);
});

it('verifyKey advances to step 3 when the CLI reports ok', async () => {
  stubChild = makeChild(['{"ok":true}'], 0); // existing harness helper
  // set state.host/user/sshPort/keyPath, then:
  await driveMessage({ type: 'verifyKey', user: 'ana' });
  const last = spawnCalls.at(-1)!;
  expect(last.args).toEqual(expect.arrayContaining(['setup', '--verify-key', '--key-path']));
  // assert the wizard moved to step 3 (however the existing tests read posted state)
});
```

(The exact wizard construction + `driveMessage`/state-setting helpers already exist in this file's earlier test — follow that pattern; the assertions above are the new behavior to verify.)

- [ ] **Step 3: Run the tests, confirm they fail** (`pnpm --filter patchwire-vscode exec vitest run src/setup/SetupWizard.test.ts`) — Expected: `openKeyInstallTerminal` / `verifyKey` are unknown message types.

- [ ] **Step 4: Implement the handlers.** In `SetupWizard.ts` `handleMessage`, **remove the entire `case 'step2Submit': { ... }`** block and add:

```ts
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
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm --filter patchwire-vscode exec vitest run src/setup/SetupWizard.test.ts` PASS; `pnpm --filter patchwire-vscode test` all pass; `pnpm --filter patchwire-vscode typecheck` clean.
- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/test/vscode-stub.ts packages/extension/src/setup/SetupWizard.ts packages/extension/src/setup/SetupWizard.test.ts
git commit -m "feat(extension): terminal-based key install + verify in the setup wizard host"
```

---

## Task 3: Extension webview — Step 2 buttons

**Files:** Modify `src/setup/webview/main.ts`. No webview test harness — typecheck + build + render note.

- [ ] **Step 1: Rebuild `renderStep2`.** Replace the entire `function renderStep2()` with:

```ts
function renderStep2(): HTMLElement {
  const container = h('div', {},
    h('h1', {}, 'Step 2 — Install your SSH key'),
    h('p', { className: 'note' }, 'We add a per-project SSH key to the remote so future connections need no password. You type your password once, in the terminal.'),
  );

  const userInput = h('input', { type: 'text', placeholder: 'rebin', value: state.user ?? '' }) as HTMLInputElement;
  userInput.addEventListener('input', () => { state.user = userInput.value; });
  container.append(h('div', { className: 'form-row' },
    h('label', {}, 'SSH username'),
    userInput,
  ));

  container.append(h('ol', { className: 'note' },
    h('li', {}, 'Click "Open terminal & install key".'),
    h('li', {}, 'In the terminal, enter your remote password when prompted (and type "yes" if asked to trust the host).'),
    h('li', {}, 'When it finishes, click "Verify & continue".'),
  ));

  if (step2Result && !step2Result.ok) {
    container.append(h('p', { className: 'error' },
      step2Result.stderr
        ? `Not connected yet: ${step2Result.stderr}`
        : 'Not connected yet. Finish the steps in the terminal, then click Verify. If you saw "REMOTE HOST IDENTIFICATION HAS CHANGED", run: ssh-keygen -R <host>',
    ));
  }
  if (state.error) container.append(h('p', { className: 'error' }, state.error));
  if (state.busy) container.append(h('p', { className: 'note' }, h('span', { className: 'spinner' }, '⟳'), ' Verifying…'));

  container.append(h('div', { className: 'actions' },
    h('button', { className: 'secondary', events: { click: () => vscode.postMessage({ type: 'back' }) } }, 'Back'),
    h('button', {
      className: 'secondary',
      events: { click: () => {
        if (!state.user) return;
        step2Result = undefined;
        vscode.postMessage({ type: 'openKeyInstallTerminal', user: state.user });
      } },
    }, 'Open terminal & install key'),
    h('button', {
      disabled: state.busy,
      events: { click: () => {
        if (!state.user) return;
        step2Result = undefined;
        vscode.postMessage({ type: 'verifyKey', user: state.user });
      } },
    }, 'Verify & continue'),
  ));

  return container;
}
```

Remove the now-unused `pwValue` module-level variable (and any other password-only references) if the compiler flags them.

- [ ] **Step 2: Typecheck + build** — `pnpm --filter patchwire-vscode typecheck` clean; `pnpm --filter patchwire-vscode build` success (setup webview IIFE rebuilds).

- [ ] **Step 3: Render note (PR).** In the Extension Development Host, run **Patchwire: Setup** to Step 2: entering a username and clicking "Open terminal & install key" opens a terminal running `ssh-keygen`/`ssh-copy-id`; after completing it, "Verify & continue" advances to Step 3; clicking Verify too early shows "Not connected yet."

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/setup/webview/main.ts
git commit -m "feat(extension): Step 2 uses terminal install + Verify buttons (no password field)"
```

---

## Final verification

- [ ] `pnpm --filter @rebink/patchwire test` and `pnpm --filter patchwire-vscode test` pass; both typecheck clean; `pnpm --filter patchwire-vscode build` clean (bundle guard passes, vsix has no native binary).
- [ ] `grep -rn "sshpass\|password-stdin" packages/cli/src packages/extension/src` returns nothing (sshpass fully removed).
- [ ] `git diff --stat main...HEAD` touches only the planned files + the spec/plan.
