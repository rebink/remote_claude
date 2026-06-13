# Provision Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build `provisionRemote(conn, opts, deps?)` — the end-to-end orchestrator that runs `detect → plan → preview → consent → runProvision(remoteExecutor) → verify`, returning a structured result (completed / rolled-back / cancelled, with the plan, outcome, degraded list, and a non-fatal health report).

**Architecture:** A new `packages/cli/src/agent/provision/provision-remote.ts`. Pure control flow over injected deps (`detect`, `makeExecutor`, `verify`, `confirm`, `onEvent`) so it unit-tests with zero real SSH; defaults wire to the real `detectRemoteServerPlatform` + `remoteExecutor`. Consent is a gate callback shown the plan + the steps needing elevation; verify runs only on a completed outcome and is non-fatal.

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`). Composes `remote-detect.ts`, `plan.ts`, `run.ts`, `remote-executor.ts`.

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md` (Architecture flow; §2 preview/consent; §5 verify non-fatal).

---

### Task 1: provisionRemote control flow (TDD)

**Files:**
- Create: `packages/cli/src/agent/provision/provision-remote.ts`
- Test: `packages/cli/test/agent/provision/provision-remote.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { provisionRemote } from '../../../src/agent/provision/provision-remote.ts';
import type { ProvisionRemoteDeps, HealthReport } from '../../../src/agent/provision/provision-remote.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';
import type { StepExecutor } from '../../../src/agent/provision/types.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

function detected(os: DetectedServerPlatform['os'] = 'macos'): DetectedServerPlatform {
  return {
    os, arch: 'arm64', pathStyle: os === 'windows' ? 'win' : 'posix',
    capabilities: {
      egress: { type: 'seatbelt', requiresElevation: false },
      filesystemIsolation: { type: 'seatbelt', requiresElevation: false },
      secrets: { type: 'keychain', requiresElevation: false },
      service: { type: 'launchd', requiresElevation: false },
      shell: { type: 'zsh', requiresElevation: false },
      packageManager: { type: 'brew', requiresElevation: false },
    },
  };
}

const HEALTHY: HealthReport = { tailnet: true, agent: 'healthy' };
const okExecutor: StepExecutor = async () => ({ result: { ok: true } });

function baseDeps(over: Partial<ProvisionRemoteDeps> = {}): ProvisionRemoteDeps {
  return {
    detect: async () => detected(),
    makeExecutor: () => okExecutor,
    verify: async () => HEALTHY,
    ...over,
  };
}

describe('provisionRemote', () => {
  it('runs detect→plan→preview→execute→verify and returns completed with health', async () => {
    const events: { type: string }[] = [];
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({ onEvent: (e) => events.push(e) }));
    expect(res.status).toBe('completed');
    expect(res.detected?.os).toBe('macos');
    expect(res.plan?.steps.length).toBeGreaterThan(0);
    expect(res.health).toEqual(HEALTHY);
    expect(events.some((e) => e.type === 'preview')).toBe(true);
  });

  it('cancels (no execution, no verify) when confirm declines', async () => {
    let executed = false;
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({
      makeExecutor: () => async () => { executed = true; return { result: { ok: true } }; },
      confirm: () => false,
      verify: async () => { throw new Error('verify must not run on cancel'); },
    }));
    expect(res.status).toBe('cancelled');
    expect(executed).toBe(false);
    expect(res.health).toBeUndefined();
  });

  it('proceeds when confirm approves, passing the elevation list', async () => {
    let sawElevation: unknown;
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({
      confirm: (_plan, elevation) => { sawElevation = elevation; return true; },
    }));
    expect(res.status).toBe('completed');
    expect(Array.isArray(sawElevation)).toBe(true);
  });

  it('returns rolled-back and does NOT verify when a step fails', async () => {
    const failing: StepExecutor = async (s) => (s.id === 'write-secret' ? { result: { ok: false, detail: 'boom' } } : { result: { ok: true } });
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({
      makeExecutor: () => failing,
      verify: async () => { throw new Error('verify must not run on rollback'); },
    }));
    expect(res.status).toBe('rolled-back');
    expect(res.outcome?.failedStep).toBe('write-secret');
    expect(res.health).toBeUndefined();
  });

  it('aggregates degraded steps into the outcome', async () => {
    const degrading: StepExecutor = async (s) => (s.id === 'apply-egress' ? { result: { ok: true, degraded: true, detail: 'egress warn-only' } } : { result: { ok: true } });
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({ makeExecutor: () => degrading }));
    expect(res.status).toBe('completed');
    expect(res.outcome?.degraded).toContain('egress warn-only');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- provision-remote`
Expected: FAIL — `provision-remote.ts` not found.

- [ ] **Step 3: Write `packages/cli/src/agent/provision/provision-remote.ts`**

```ts
import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { ProvisionPlan, ProvisionStep, StepExecutor, ProvisionEvent, ProvisionOutcome } from './types.ts';
import { planProvision, elevationRequired } from './plan.ts';
import { runProvision } from './run.ts';
import { detectRemoteServerPlatform, type RemoteConn } from './remote-detect.ts';
import { remoteExecutor, type RemoteExecutorOpts } from './remote-executor.ts';

/** Non-fatal post-provision health snapshot. */
export interface HealthReport {
  tailnet: boolean;
  agent: 'healthy' | 'unhealthy' | 'unknown';
  detail?: string;
}

export type ProvisionStatus = 'completed' | 'rolled-back' | 'cancelled';

export interface ProvisionRemoteResult {
  status: ProvisionStatus;
  detected?: DetectedServerPlatform;
  plan?: ProvisionPlan;
  outcome?: ProvisionOutcome;
  health?: HealthReport;
}

/** A preview emitted before consent — the full plan plus the steps that need elevation. */
export interface PreviewEvent {
  type: 'preview';
  plan: ProvisionPlan;
  elevation: ProvisionStep[];
}

export interface ProvisionRemoteDeps {
  detect?: (conn: RemoteConn) => Promise<DetectedServerPlatform>;
  makeExecutor?: (conn: RemoteConn, detected: DetectedServerPlatform, opts: RemoteExecutorOpts) => StepExecutor;
  /** Non-fatal verification, run only on a completed outcome. */
  verify?: (conn: RemoteConn, detected: DetectedServerPlatform) => Promise<HealthReport>;
  /** Consent gate shown the plan + elevation-needing steps; return true to proceed. Omit to proceed unconditionally. */
  confirm?: (plan: ProvisionPlan, elevation: ProvisionStep[]) => boolean | Promise<boolean>;
  onEvent?: (e: ProvisionEvent | PreviewEvent) => void;
}

/** Orchestrate remote provisioning: detect → plan → preview → consent → execute → verify. */
export async function provisionRemote(
  conn: RemoteConn,
  opts: RemoteExecutorOpts,
  deps: ProvisionRemoteDeps = {},
): Promise<ProvisionRemoteResult> {
  const detect = deps.detect ?? detectRemoteServerPlatform;
  const makeExecutor = deps.makeExecutor ?? remoteExecutor;
  const emit = deps.onEvent ?? (() => {});

  const detected = await detect(conn);
  const plan = planProvision(detected);
  const elevation = elevationRequired(plan);
  emit({ type: 'preview', plan, elevation });

  if (deps.confirm) {
    const proceed = await deps.confirm(plan, elevation);
    if (!proceed) return { status: 'cancelled', detected, plan };
  }

  const outcome = await runProvision(plan, {
    executor: makeExecutor(conn, detected, opts),
    onEvent: emit,
  });

  let health: HealthReport | undefined;
  if (outcome.status === 'completed' && deps.verify) {
    health = await deps.verify(conn, detected);
  }

  return { status: outcome.status, detected, plan, outcome, health };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- provision-remote`
Expected: PASS (5 tests).

- [ ] **Step 5: Full verify**

Run: `pnpm --filter @rebink/patchwire test`
Expected: 0 failed.

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/provision/provision-remote.ts packages/cli/test/agent/provision/provision-remote.test.ts
git commit -m "feat(agent): provisionRemote orchestrator (detect→plan→preview→consent→execute→verify)"
```

---

## What this plan leaves to follow-on

- A **default `verify`** implementation (tailnet check + agent `/health` via `AgentClient` over the tailnet) — injected here, real impl is a thin follow-on.
- **Refactor `runProvisionAgent` (setup.ts) onto `provisionRemote`** — the final strangler step retiring the bespoke wizard script; kept separate to avoid re-churning the wizard tests.
- A CLI/extension entry point that calls `provisionRemote` with a real `confirm`/`onEvent` (the consent UI + progress).
- Linux executors (real systemd `--user`), BinaryInstaller, nftables/Windows.

## Self-review notes

- **Spec coverage:** the full flow `detect → plan → preview → consent → runProvision(remoteExecutor) → verify` with: preview emitted before consent; consent gate that can cancel (no execution, no verify); verify non-fatal and only on completed; degraded aggregation surfaced via `outcome.degraded`. Defaults wire to the real detect/executor; everything injectable for tests.
- **Type consistency:** reuses `ProvisionPlan`/`ProvisionStep`/`StepExecutor`/`ProvisionEvent`/`ProvisionOutcome`, `RemoteConn`, `RemoteExecutorOpts`; `onEvent` accepts the `ProvisionEvent | PreviewEvent` union and is passed to `runProvision` (whose narrower `(e: ProvisionEvent)=>void` accepts a wider-typed handler).
- **Placeholder scan:** none. `verify` being optional (no default) is intentional for this slice — documented as a follow-on, not a stub.
