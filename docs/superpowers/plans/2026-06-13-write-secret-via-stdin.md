# write-secret via SSH stdin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the `write-secret` provisioning step: write the agent token to `~/.patchwire/env` on the remote **atomically** (mode 600, temp→rename) with the token delivered over **stdin**, never on the SSH argv (no `ps` leak).

**Architecture:** Two parts. (1) Extend `ssh-runner` so a command can receive stdin `input` (the default adapter pipes it to the ssh process, which forwards it to the remote command). (2) Add the `write-secret` case to `remoteExecutor`: it pipes `export PW_TOKEN='…'` over stdin into a remote `umask 077; … cat > tmp && mv -f tmp env` sequence — so the token never appears in any command string.

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`). Extends `lib/ssh-runner.ts`, `agent/provision/installer.ts` (RemoteRunner), `agent/provision/remote-executor.ts`.

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md` (§4 write-secret: atomic, mode-600, token via stdin not argv).

---

### Task 1: ssh-runner stdin support (TDD)

**Files:**
- Modify: `packages/cli/src/lib/ssh-runner.ts`
- Test: `packages/cli/test/lib/ssh-runner.test.ts`

- [ ] **Step 1: Append a failing test** (the file already imports `runSsh`; add this test)

```ts
describe('runSsh stdin', () => {
  it('forwards opts.input to the adapter as the third argument', async () => {
    let received: { args: string[]; input?: string } | undefined;
    const adapter = async (_cmd: string, args: string[], input?: string) => {
      received = { args, input };
      return { code: 0, stdout: '', stderr: '' };
    };
    await runSsh(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', command: 'cat > f', input: 'SECRET-DATA' },
      adapter,
    );
    expect(received?.input).toBe('SECRET-DATA');
    // The command (argv) must NOT contain the secret — it travels via stdin only.
    expect(received?.args.join(' ')).not.toContain('SECRET-DATA');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- ssh-runner`
Expected: FAIL — `input` not on `SshOpts` / not forwarded.

- [ ] **Step 3: Update `ssh-runner.ts`**

Add `input` to `SshOpts` (after `command`):
```ts
  /** Optional data piped to the remote command's stdin — keeps secrets off the argv (no ps leak). */
  input?: string;
```
Change the `SpawnAdapter` type to accept input:
```ts
export type SpawnAdapter = (cmd: string, args: string[], input?: string) => Promise<SpawnResult>;
```
Update `defaultAdapter` to pipe stdin when input is present:
```ts
const defaultAdapter: SpawnAdapter = (cmd, args, input) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('error', (err) => {
      resolve({ code: null, stdout, stderr: stderr + `\nspawn error: ${err.message}` });
    });
    child.on('close', (code) => { resolve({ code, stdout, stderr }); });
    if (input !== undefined && child.stdin) child.stdin.end(input);
  });
```
Update `runSsh` to forward input:
```ts
export async function runSsh(opts: SshOpts, adapter: SpawnAdapter = defaultAdapter): Promise<SpawnResult> {
  return adapter('ssh', buildSshArgv(opts), opts.input);
}
```

- [ ] **Step 4: Run test to verify it passes (and existing ssh-runner tests still pass)**

Run: `pnpm --filter @rebink/patchwire test -- ssh-runner`
Expected: PASS (existing 9 + 1 new = 10).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/ssh-runner.ts packages/cli/test/lib/ssh-runner.test.ts
git commit -m "feat(cli): ssh-runner supports stdin input (keep secrets off argv)"
```

---

### Task 2: RemoteRunner input + write-secret executor step (TDD)

**Files:**
- Modify: `packages/cli/src/agent/provision/installer.ts` (extend `RemoteRunner`, export the default runner)
- Modify: `packages/cli/src/agent/provision/remote-executor.ts` (add `write-secret`)
- Test: `packages/cli/test/agent/provision/remote-executor.test.ts` (append)

- [ ] **Step 1: Extend `RemoteRunner` + export the default runner in `installer.ts`**

Change the `RemoteRunner` type to accept optional stdin input:
```ts
export type RemoteRunner = (command: string, input?: string) => Promise<{ stdout: string; stderr: string; code: number | null }>;
```
Rename the private `defaultRunner` to an exported `defaultRemoteRunner` and forward input:
```ts
export function defaultRemoteRunner(conn: RemoteConn): RemoteRunner {
  return async (command, input) => {
    const r = await runSsh({ ...conn, command, input });
    return { stdout: r.stdout, stderr: r.stderr, code: r.code };
  };
}
```
Update the internal reference in `corepackPnpmInstaller` (its `runner = defaultRunner(conn)` default) to use `defaultRemoteRunner`. (No other behavior change — the installer never passes input.)

- [ ] **Step 2: Append the failing test to `remote-executor.test.ts`**

```ts
import { quoteForShell } from '../../../src/lib/ssh-runner.ts';

describe('remoteExecutor — write-secret', () => {
  it('writes the token atomically via stdin, keeping it off the command argv', async () => {
    const calls: { command: string; input?: string }[] = [];
    const runner = async (command: string, input?: string) => {
      calls.push({ command, input });
      return { stdout: '', stderr: '', code: 0 };
    };
    const exec = remoteExecutor(CONN, detected('linux'), { token: 'TKN-123', installer: fakeInstaller([]), runner });
    const out = await exec(step('write-secret'));

    expect(out.result.ok).toBe(true);
    const write = calls[0]!;
    // Atomic temp→rename, mode 600 via umask, into ~/.patchwire/env
    expect(write.command).toContain('umask 077');
    expect(write.command).toContain('mkdir -p');
    expect(write.command).toMatch(/cat > .*env\.tmp/);
    expect(write.command).toMatch(/mv -f .*env\.tmp.* .*\/\.patchwire\/env/);
    // The token is in the STDIN payload, never in the command argv (no ps leak).
    expect(write.command).not.toContain('TKN-123');
    expect(write.input).toBe(`export PW_TOKEN=${quoteForShell('TKN-123')}\n`);

    // compensate removes the secret file.
    await out.compensate!();
    expect(calls[1]!.command).toMatch(/rm -f .*\/\.patchwire\/env/);
  });

  it('write-secret reports failure (no compensate) on non-zero exit', async () => {
    const runner = async () => ({ stdout: '', stderr: 'denied', code: 1 });
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('write-secret'));
    expect(out.result.ok).toBe(false);
    expect(out.compensate).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: FAIL — `write-secret` not handled (falls into the degraded default) and `opts.runner` unused.

- [ ] **Step 4: Update `remote-executor.ts`**

Add imports + extend opts + handle the step. Final file:
```ts
import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { StepExecutor } from './types.ts';
import { corepackPnpmInstaller, defaultRemoteRunner, type AgentInstaller, type RemoteConn, type RemoteRunner } from './installer.ts';
import { quoteForShell } from '../../lib/ssh-runner.ts';

export interface RemoteExecutorOpts {
  /** Agent bearer token to provision onto the remote. */
  token: string;
  /** Override the agent installer (defaults to Corepack/pnpm for POSIX hosts). */
  installer?: AgentInstaller;
  /** Override the SSH command runner used by non-installer steps (defaults to SSH over `conn`). */
  runner?: RemoteRunner;
}

/** Atomic, mode-600 remote write driven over stdin so the token never hits the argv. */
const WRITE_ENV_CMD =
  'umask 077; mkdir -p "$HOME/.patchwire" && cat > "$HOME/.patchwire/env.tmp" && mv -f "$HOME/.patchwire/env.tmp" "$HOME/.patchwire/env"';

export function remoteExecutor(
  conn: RemoteConn,
  detected: DetectedServerPlatform,
  opts: RemoteExecutorOpts,
): StepExecutor {
  const installer = opts.installer ?? corepackPnpmInstaller(conn);
  const runner = opts.runner ?? defaultRemoteRunner(conn);
  return async (step) => {
    switch (step.id) {
      case 'bootstrap-agent':
        if (detected.os === 'windows') {
          return { result: { ok: false, detail: 'Windows agent install is not yet supported' } };
        }
        return installer.install();

      case 'write-secret': {
        const payload = `export PW_TOKEN=${quoteForShell(opts.token)}\n`;
        const r = await runner(WRITE_ENV_CMD, payload);
        if (r.code !== 0) {
          return { result: { ok: false, detail: (r.stderr || r.stdout || 'write-secret failed').trim() } };
        }
        return {
          result: { ok: true, detail: 'token written to ~/.patchwire/env (mode 600)' },
          compensate: async () => {
            await runner('rm -f "$HOME/.patchwire/env"');
          },
        };
      }

      default:
        return { result: { ok: true, degraded: true, detail: `step "${step.id}" not yet implemented` } };
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: PASS (3 prior + 2 new = 5).

- [ ] **Step 6: Full verify**

Run: `pnpm --filter @rebink/patchwire test`
Expected: 0 failed (the installer tests still pass with the widened `RemoteRunner` signature).

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/agent/provision/installer.ts packages/cli/src/agent/provision/remote-executor.ts packages/cli/test/agent/provision/remote-executor.test.ts
git commit -m "feat(agent): write-secret step — atomic mode-600 write, token via stdin"
```

---

## What this plan leaves to follow-on plans

- Remaining macOS executors: `install-mutagen` (checksum-pinned), `install-service` (launchd / systemd `--user`), `apply-egress` (seatbelt; Linux/Windows degraded), `bind-tailnet`.
- Optionally write `PW_USER` alongside `PW_TOKEN` (the env content can be parameterized via opts).
- Preview + consent + non-fatal verify orchestrator, then refactoring `runProvisionAgent` onto it.

## Self-review notes

- **Spec coverage (§4 write-secret):** atomic (`cat > env.tmp && mv -f`), mode-600 (`umask 077`), token over **stdin** not argv (test asserts the command never contains the token and the payload carries it). Compensation deletes the secret. ✓
- **Type consistency:** `RemoteRunner` gains an optional `input` param (backward-compatible — installer fakes ignore it); `defaultRemoteRunner` replaces the private `defaultRunner`; `remoteExecutor`'s `write-secret` uses `opts.runner ?? defaultRemoteRunner(conn)`; `SshOpts.input` + the 3-arg `SpawnAdapter` are additive (existing adapters ignore the third arg).
- **Placeholder scan:** none — complete code; `quoteForShell` single-quotes the token so the written `export` line is source-safe.
