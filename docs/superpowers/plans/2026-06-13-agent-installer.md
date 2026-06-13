# AgentInstaller (Corepack + pnpm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `AgentInstaller` interface (`check`/`install`/`uninstall`/`version`) and a `corepackPnpmInstaller` that installs the patchwire agent on a POSIX remote over SSH via Corepack + pnpm, with an uninstall as its compensating action.

**Architecture:** `packages/cli/src/agent/provision/installer.ts`. All remote commands run through an injected `RemoteRunner` (default wraps `runSsh`), so unit tests assert the exact remote command strings with zero real SSH. Reuses `quoteForShell` for safety and the `StepResult`/`CompensatingAction` types from the provisioning engine. This is the POSIX (macOS + Linux) installer; a Windows installer and a prerequisite-free `BinaryInstaller` implement the same interface later.

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`, tests under `packages/cli/test/`). Reuses `lib/ssh-runner.ts` and `agent/provision/types.ts`.

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md` (§3 AgentInstaller interface).

---

## File structure

- Create: `packages/cli/src/agent/provision/installer.ts` — `AgentInstaller`, `RemoteConn`, `RemoteRunner`, `corepackPnpmInstaller`.
- Test: `packages/cli/test/agent/provision/installer.test.ts`.

Reference facts: `lib/ssh-runner.ts` exports `runSsh(opts)`, `quoteForShell(value)`, `SshOpts = {host,user,port,keyPath,command}`, `SpawnResult = {code,stdout,stderr}`. `provision/types.ts` exports `StepResult = {ok,degraded?,detail?}`… (here only `{ok,detail?}` is used) and `CompensatingAction = () => Promise<void>`. The repo pins **pnpm@10.26.1** (root `packageManager`). The published agent package is **`@rebink/patchwire`**.

---

### Task 1: Interface + version/check (TDD)

**Files:**
- Create: `packages/cli/src/agent/provision/installer.ts`
- Test: `packages/cli/test/agent/provision/installer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { corepackPnpmInstaller } from '../../../src/agent/provision/installer.ts';
import type { RemoteRunner } from '../../../src/agent/provision/installer.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

/** Records every command and returns scripted results in order (or a default). */
function fakeRunner(results: Array<{ stdout?: string; stderr?: string; code: number }>): {
  runner: RemoteRunner;
  commands: string[];
} {
  const commands: string[] = [];
  let i = 0;
  const runner: RemoteRunner = async (command) => {
    commands.push(command);
    const r = results[i++] ?? { code: 0 };
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code };
  };
  return { runner, commands };
}

describe('corepackPnpmInstaller.version / check', () => {
  it('version returns the trimmed CLI version, or null on non-zero exit', async () => {
    const ok = corepackPnpmInstaller(CONN, fakeRunner([{ stdout: '0.3.18\n', code: 0 }]).runner);
    expect(await ok.version()).toBe('0.3.18');

    const missing = corepackPnpmInstaller(CONN, fakeRunner([{ code: 127 }]).runner);
    expect(await missing.version()).toBeNull();
  });

  it('check reports present/version from the version probe', async () => {
    const present = corepackPnpmInstaller(CONN, fakeRunner([{ stdout: '0.3.18', code: 0 }]).runner);
    expect(await present.check()).toEqual({ present: true, version: '0.3.18' });

    const absent = corepackPnpmInstaller(CONN, fakeRunner([{ code: 127 }]).runner);
    expect(await absent.check()).toEqual({ present: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- installer`
Expected: FAIL — `installer.ts` not found.

- [ ] **Step 3: Write `packages/cli/src/agent/provision/installer.ts`**

```ts
import { runSsh, type SshOpts } from '../../lib/ssh-runner.ts';
import type { StepResult, CompensatingAction } from './types.ts';

/** SSH connection params without the per-call `command`. */
export type RemoteConn = Omit<SshOpts, 'command'>;

/** Runs one command on the remote, returning its streams + exit code. Injected for testing. */
export type RemoteRunner = (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>;

/** Installs/uninstalls the patchwire agent on a remote. One impl per OS / distribution mechanism. */
export interface AgentInstaller {
  /** Installed agent version, or null if absent. */
  version(): Promise<string | null>;
  /** Presence + version. */
  check(): Promise<{ present: boolean; version?: string }>;
  /** Install the agent; returns a result and (on success) a compensating uninstall. */
  install(): Promise<{ result: StepResult; compensate?: CompensatingAction }>;
  /** Remove the agent. */
  uninstall(): Promise<StepResult>;
}

/** Pinned to the repo's `packageManager` so the remote uses the same pnpm. */
const PNPM_VERSION = '10.26.1';
const PACKAGE = '@rebink/patchwire';

function defaultRunner(conn: RemoteConn): RemoteRunner {
  return async (command) => {
    const r = await runSsh({ ...conn, command });
    return { stdout: r.stdout, stderr: r.stderr, code: r.code };
  };
}

/** POSIX (macOS + Linux) installer: Corepack-activated pnpm installs the agent globally. */
export function corepackPnpmInstaller(
  conn: RemoteConn,
  runner: RemoteRunner = defaultRunner(conn),
): AgentInstaller {
  async function version(): Promise<string | null> {
    const r = await runner('patchwire --version');
    if (r.code !== 0) return null;
    const v = r.stdout.trim();
    return v.length > 0 ? v : null;
  }

  async function uninstall(): Promise<StepResult> {
    const r = await runner(`pnpm remove -g ${PACKAGE}`);
    return r.code === 0
      ? { ok: true, detail: 'removed' }
      : { ok: false, detail: (r.stderr || r.stdout || 'uninstall failed').trim() };
  }

  return {
    version,
    uninstall,
    async check() {
      const v = await version();
      return v === null ? { present: false } : { present: true, version: v };
    },
    async install() {
      const cmd =
        `corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate && pnpm add -g ${PACKAGE}`;
      const r = await runner(cmd);
      if (r.code !== 0) {
        return { result: { ok: false, detail: (r.stderr || r.stdout || 'install failed').trim() } };
      }
      return {
        result: { ok: true, detail: `installed ${PACKAGE} via corepack+pnpm` },
        compensate: async () => {
          await uninstall();
        },
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- installer`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/provision/installer.ts packages/cli/test/agent/provision/installer.test.ts
git commit -m "feat(agent): AgentInstaller interface + version/check"
```

---

### Task 2: install / uninstall / compensate (TDD)

**Files:**
- Test: `packages/cli/test/agent/provision/installer.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
describe('corepackPnpmInstaller.install / uninstall', () => {
  it('install runs corepack+pnpm and returns ok with a compensating uninstall', async () => {
    const f = fakeRunner([{ code: 0 }, { code: 0 }]); // [install, uninstall(via compensate)]
    const inst = corepackPnpmInstaller(CONN, f.runner);
    const { result, compensate } = await inst.install();
    expect(result.ok).toBe(true);
    expect(f.commands[0]).toContain('corepack enable');
    expect(f.commands[0]).toContain('corepack prepare pnpm@10.26.1 --activate');
    expect(f.commands[0]).toContain('pnpm add -g @rebink/patchwire');
    expect(typeof compensate).toBe('function');

    await compensate!();
    expect(f.commands[1]).toBe('pnpm remove -g @rebink/patchwire');
  });

  it('install reports failure (no compensate) on non-zero exit', async () => {
    const inst = corepackPnpmInstaller(CONN, fakeRunner([{ code: 1, stderr: 'EACCES' }]).runner);
    const { result, compensate } = await inst.install();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('EACCES');
    expect(compensate).toBeUndefined();
  });

  it('uninstall runs pnpm remove and reports ok', async () => {
    const inst = corepackPnpmInstaller(CONN, fakeRunner([{ code: 0 }]).runner);
    expect(await inst.uninstall()).toEqual({ ok: true, detail: 'removed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- installer`
Expected: the install/uninstall tests run against the Task 1 implementation. If Task 1 was implemented exactly, these PASS immediately (the impl already covers install/uninstall). If any assertion fails, fix the implementation in `installer.ts` to match — do not change the test expectations.

- [ ] **Step 3: Confirm passing + full verify**

Run: `pnpm --filter @rebink/patchwire test -- installer`
Expected: PASS (5 tests total).

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0, no regressions.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/test/agent/provision/installer.test.ts
git commit -m "test(agent): cover AgentInstaller install/uninstall/compensate"
```

---

## What this plan leaves to follow-on plans

- `RemoteExecutor` (per-OS step dispatch) that calls this installer for the `bootstrap-agent` step, plus the other macOS executors (mutagen / secret / service / egress / tailnet).
- Plan **preview** + **consent**, non-fatal **verify**, the `StepResult.degraded?` engine extension, and refactoring `runProvisionAgent` onto `runProvision`.
- `BinaryInstaller` (prerequisite-free) and a Windows installer — both implement this same `AgentInstaller` interface.

## Self-review notes

- **Spec coverage (§3):** the `AgentInstaller` interface with `check`/`install`/`uninstall`/`version` and the `CorepackPnpmInstaller` (corepack enable → prepare pnpm@pinned → `pnpm add -g @rebink/patchwire`; uninstall via `pnpm remove -g`; install returns a compensating uninstall) are covered by Tasks 1–2. The login-shell wrapping and per-OS executor dispatch are deferred to the RemoteExecutor plan (the installer takes a plain `RemoteRunner`, so the executor decides whether to wrap in `bash -lc`).
- **Type consistency:** `RemoteConn = Omit<SshOpts,'command'>` matches `remote-detect.ts`; `RemoteRunner` returns `{stdout,stderr,code}`; `StepResult`/`CompensatingAction` reused from `provision/types.ts`; `corepackPnpmInstaller(conn, runner?)` signature stable across both tasks.
- **Placeholder scan:** none — complete code; `PNPM_VERSION`/`PACKAGE` are concrete pinned constants, not placeholders.
