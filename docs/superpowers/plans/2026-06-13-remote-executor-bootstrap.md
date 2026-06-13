# RemoteExecutor (engine degraded extension + bootstrap-agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the provisioning engine to distinguish **degraded** (ok-but-incomplete) from **fatal** step results, and add the `RemoteExecutor` that maps plan steps to actions — wiring `bootstrap-agent` to the `AgentInstaller` (other steps stubbed as degraded for now).

**Architecture:** Two parts. (1) `StepResult` gains `degraded?: boolean`; `runProvision` aggregates degraded steps into `ProvisionOutcome.degraded[]` and emits a `degraded` step status, **without** triggering rollback (only `ok: false` rolls back). (2) `remoteExecutor(conn, detected, opts)` returns a `StepExecutor` (the type `runProvision` consumes); `bootstrap-agent` delegates to the injected `AgentInstaller`; unimplemented steps return `degraded` so a partial run completes honestly rather than failing.

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`, tests under `packages/cli/test/`). Reuses `provision/{types,run,installer}.ts`.

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md` (§4 executor steps, §5 fatal-vs-verification).

---

## File structure

- Modify: `packages/cli/src/agent/provision/types.ts` — `StepResult.degraded?`; `ProvisionOutcome.degraded`; `ProvisionEvent` step status `+ 'degraded'`.
- Modify: `packages/cli/src/agent/provision/run.ts` — aggregate degraded, emit `degraded` status, never roll back on degraded.
- Modify: `packages/cli/test/agent/provision/run.test.ts` — update 3 outcome assertions; add a degraded test.
- Create: `packages/cli/src/agent/provision/remote-executor.ts` — `remoteExecutor` + `RemoteExecutorOpts`.
- Test: `packages/cli/test/agent/provision/remote-executor.test.ts`.

---

### Task 1: Engine degraded extension (TDD)

**Files:**
- Modify: `packages/cli/src/agent/provision/types.ts`
- Modify: `packages/cli/src/agent/provision/run.ts`
- Modify: `packages/cli/test/agent/provision/run.test.ts`

- [ ] **Step 1: Update `types.ts`**

Change `StepResult`:
```ts
export interface StepResult {
  ok: boolean;
  /** Completed, but a non-critical capability isn't fully there (e.g. egress warn-only). Not a failure. */
  degraded?: boolean;
  detail?: string;
}
```
Change the `ProvisionEvent` step member to allow a `degraded` status:
```ts
  | { type: 'step'; step: string; status: 'start' | 'ok' | 'degraded' | 'failed'; detail?: string }
```
Change `ProvisionOutcome`:
```ts
export interface ProvisionOutcome {
  status: 'completed' | 'rolled-back';
  failedStep?: string;
  /** Details of steps that completed in a degraded state. */
  degraded: string[];
}
```

- [ ] **Step 2: Update the existing `run.test.ts` outcome assertions to include `degraded: []`, then add a failing degraded test**

Update these three existing assertions (they currently omit `degraded`):
- `expect(out).toEqual({ status: 'completed' });` → `expect(out).toEqual({ status: 'completed', degraded: [] });`
- `expect(out).toEqual({ status: 'rolled-back', failedStep: 'c' });` → `expect(out).toEqual({ status: 'rolled-back', failedStep: 'c', degraded: [] });`
- `expect(out).toEqual({ status: 'rolled-back', failedStep: 'b' });` → `expect(out).toEqual({ status: 'rolled-back', failedStep: 'b', degraded: [] });`

Append a new test (this is the failing one driving the change):
```ts
describe('runProvision — degraded steps', () => {
  it('collects degraded steps without rolling back and reports them in the outcome', async () => {
    const events: ProvisionEvent[] = [];
    const executor: StepExecutor = async (step) =>
      step.id === 'b'
        ? { result: { ok: true, degraded: true, detail: 'b is warn-only' } }
        : { result: { ok: true } };
    const out = await runProvision(PLAN, { executor, onEvent: (e) => events.push(e) });
    expect(out).toEqual({ status: 'completed', degraded: ['b is warn-only'] });
    expect(events.some((e) => e.type === 'step' && e.status === 'degraded' && e.step === 'b')).toBe(true);
    expect(events.some((e) => e.type === 'rollback')).toBe(false);
  });
});
```
(The existing test file already imports `runProvision`, `ProvisionEvent`, `StepExecutor`, and defines `PLAN` with steps `a`,`b`,`c` — reuse them.)

- [ ] **Step 3: Run tests to verify the new one fails (and the 3 edited ones now expect `degraded`)**

Run: `pnpm --filter @rebink/patchwire test -- provision/run`
Expected: FAIL — outcomes lack `degraded`.

- [ ] **Step 4: Update `run.ts`**

Replace the body of `runProvision` so it tracks degraded and never rolls back on degraded:

```ts
export async function runProvision(plan: ProvisionPlan, deps: RunProvisionDeps): Promise<ProvisionOutcome> {
  const emit = deps.onEvent ?? (() => {});
  const applied: { step: string; compensate: CompensatingAction }[] = [];
  const degraded: string[] = [];

  emit({ type: 'phase', phase: 'execute' });
  for (const step of plan.steps) {
    emit({ type: 'step', step: step.id, status: 'start' });

    let outcome: { result: { ok: boolean; degraded?: boolean; detail?: string }; compensate?: CompensatingAction };
    try {
      outcome = await deps.executor(step);
    } catch (err) {
      outcome = { result: { ok: false, detail: err instanceof Error ? err.message : String(err) } };
    }

    if (!outcome.result.ok) {
      emit({ type: 'step', step: step.id, status: 'failed', detail: outcome.result.detail });
      await rollback(applied, emit);
      emit({ type: 'done', status: 'rolled-back', failedStep: step.id });
      return { status: 'rolled-back', failedStep: step.id, degraded };
    }

    if (outcome.result.degraded) {
      degraded.push(outcome.result.detail ?? step.id);
      emit({ type: 'step', step: step.id, status: 'degraded', detail: outcome.result.detail });
    } else {
      emit({ type: 'step', step: step.id, status: 'ok', detail: outcome.result.detail });
    }
    if (outcome.compensate) applied.push({ step: step.id, compensate: outcome.compensate });
  }

  emit({ type: 'done', status: 'completed' });
  return { status: 'completed', degraded };
}
```
(The `rollback` helper and imports are unchanged. Update the inline `outcome` type to include `degraded?`.)

- [ ] **Step 5: Run tests to verify all pass**

Run: `pnpm --filter @rebink/patchwire test -- provision/run`
Expected: PASS (5 tests: 4 prior updated + 1 new).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/provision/types.ts packages/cli/src/agent/provision/run.ts packages/cli/test/agent/provision/run.test.ts
git commit -m "feat(agent): provisioning engine tracks degraded steps (non-fatal)"
```

---

### Task 2: remoteExecutor + bootstrap-agent dispatch (TDD)

**Files:**
- Create: `packages/cli/src/agent/provision/remote-executor.ts`
- Test: `packages/cli/test/agent/provision/remote-executor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { remoteExecutor } from '../../../src/agent/provision/remote-executor.ts';
import type { AgentInstaller } from '../../../src/agent/provision/installer.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

function detected(os: DetectedServerPlatform['os']): DetectedServerPlatform {
  return {
    os, arch: 'x64', pathStyle: os === 'windows' ? 'win' : 'posix',
    capabilities: {
      egress: { type: 'none', requiresElevation: false },
      filesystemIsolation: { type: 'none', requiresElevation: false },
      secrets: { type: 'file', requiresElevation: false },
      service: { type: 'none', requiresElevation: false },
      shell: { type: 'bash', requiresElevation: false },
      packageManager: { type: 'manual', requiresElevation: false },
    },
  };
}

const fakeInstaller = (calls: string[]): AgentInstaller => ({
  version: async () => null,
  check: async () => ({ present: false }),
  uninstall: async () => { calls.push('uninstall'); return { ok: true }; },
  install: async () => {
    calls.push('install');
    return { result: { ok: true, detail: 'installed' }, compensate: async () => { calls.push('compensate'); } };
  },
});

const step = (id: string) => ({ id, title: id, requiresElevation: false });

describe('remoteExecutor', () => {
  it('bootstrap-agent delegates to the injected AgentInstaller', async () => {
    const calls: string[] = [];
    const exec = remoteExecutor(CONN, detected('macos'), { token: 't', installer: fakeInstaller(calls) });
    const out = await exec(step('bootstrap-agent'));
    expect(out.result.ok).toBe(true);
    expect(calls).toEqual(['install']);
    expect(typeof out.compensate).toBe('function');
  });

  it('bootstrap-agent fails (fatal) on a Windows remote (not yet supported)', async () => {
    const exec = remoteExecutor(CONN, detected('windows'), { token: 't', installer: fakeInstaller([]) });
    const out = await exec(step('bootstrap-agent'));
    expect(out.result.ok).toBe(false);
    expect(out.result.detail).toMatch(/Windows/);
  });

  it('an unimplemented step completes as degraded (non-fatal)', async () => {
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]) });
    const out = await exec(step('install-mutagen'));
    expect(out.result).toEqual({ ok: true, degraded: true, detail: 'step "install-mutagen" not yet implemented' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: FAIL — `remote-executor.ts` not found.

- [ ] **Step 3: Write `packages/cli/src/agent/provision/remote-executor.ts`**

```ts
import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { StepExecutor } from './types.ts';
import { corepackPnpmInstaller, type AgentInstaller, type RemoteConn } from './installer.ts';

export interface RemoteExecutorOpts {
  /** Agent bearer token to provision onto the remote. */
  token: string;
  /** Override the agent installer (defaults to Corepack/pnpm for POSIX hosts). */
  installer?: AgentInstaller;
}

/**
 * Build the StepExecutor that `runProvision` drives, dispatching each step to a remote action.
 * This slice implements `bootstrap-agent`; other steps complete as degraded until their slices land.
 */
export function remoteExecutor(
  conn: RemoteConn,
  detected: DetectedServerPlatform,
  opts: RemoteExecutorOpts,
): StepExecutor {
  const installer = opts.installer ?? corepackPnpmInstaller(conn);
  return async (step) => {
    switch (step.id) {
      case 'bootstrap-agent':
        if (detected.os === 'windows') {
          return { result: { ok: false, detail: 'Windows agent install is not yet supported' } };
        }
        return installer.install();
      default:
        return { result: { ok: true, degraded: true, detail: `step "${step.id}" not yet implemented` } };
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: PASS (3 tests).

- [ ] **Step 5: Full verify**

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/provision/remote-executor.ts packages/cli/test/agent/provision/remote-executor.test.ts
git commit -m "feat(agent): RemoteExecutor with bootstrap-agent step (degraded stub for rest)"
```

---

## What this plan leaves to follow-on plans

- **`write-secret`** done correctly — token via **stdin**, not argv (requires extending `ssh-runner` to pipe stdin), atomic mode-600 temp→rename.
- The remaining macOS executors: `install-mutagen` (checksum-pinned), `install-service` (launchd / systemd `--user`), `apply-egress` (seatbelt; Linux/Windows degraded), `bind-tailnet`.
- **Preview + consent + non-fatal verify** flow and the top-level orchestrator wiring `detectRemote → planProvision → preview → consent → runProvision(remoteExecutor) → verify`.
- Refactoring `runProvisionAgent` (setup.ts) onto this orchestrator.

## Self-review notes

- **Spec coverage:** §5 fatal-vs-degraded is implemented in the engine (degraded aggregated, non-fatal, distinct event status); §4 `bootstrap-agent` wires to the `AgentInstaller`; other §4 steps explicitly deferred with an honest degraded stub. Windows bootstrap fails fatally (honest, since no Windows installer exists).
- **Type consistency:** `StepResult.degraded?` and `ProvisionOutcome.degraded` are used identically in `run.ts`, `run.test.ts`, and `remote-executor.ts`; `remoteExecutor` returns the exact `StepExecutor` shape (`{ result, compensate? }`); `RemoteConn`/`AgentInstaller` reused from `installer.ts`.
- **Placeholder scan:** none — the degraded "not yet implemented" stub is intentional, honest interim behavior (a partial run completes degraded rather than silently doing nothing or failing), not a TODO.
