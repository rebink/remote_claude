# S1 — Provisioning Engine (plan + compensating-action rollback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the generic provisioning state-machine engine — compute a `ProvisionPlan` from a detected platform, run its steps through an injected executor, and roll back via compensating actions on failure — without the real install behaviors (those inject later).

**Architecture:** New `packages/cli/src/agent/provision/` module. `planProvision(detected)` is a pure plan builder. `runProvision(plan, { executor, onEvent })` is a generic engine: executors are injected (each step returns a result + an optional compensating action), so the engine is fully unit-testable with mocks and the macOS/Linux/Windows install behaviors plug in during the behavior slice. Models the Agent spec's `detect → plan → consent → execute → verify → (rollback)` with best-effort, reverse-order compensation.

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`, tests under `packages/cli/test/`).

**Spec:** `docs/specs/2026-06-12-agent-protocol-spec.md` (Pillar 2 — Provisioning state machine + rollback via compensating actions).

---

### Task 1: Provisioning types

**Files:** Create `packages/cli/src/agent/provision/types.ts`

- [ ] **Step 1: Write the file**

```ts
export type ProvisionPhase = 'detect' | 'plan' | 'consent' | 'execute' | 'verify' | 'rollback';

export interface ProvisionStep {
  id: string;
  title: string;
  requiresElevation: boolean;
}

export interface ProvisionPlan {
  steps: ProvisionStep[];
}

export interface StepResult {
  ok: boolean;
  detail?: string;
}

/** Undo a previously-applied step. Best-effort, idempotent. */
export type CompensatingAction = () => Promise<void>;

/** Execute one step; return its result plus an optional compensating action to undo it. */
export type StepExecutor = (
  step: ProvisionStep,
) => Promise<{ result: StepResult; compensate?: CompensatingAction }>;

export type ProvisionEvent =
  | { type: 'phase'; phase: ProvisionPhase }
  | { type: 'step'; step: string; status: 'start' | 'ok' | 'failed'; detail?: string }
  | { type: 'rollback'; step: string }
  | { type: 'done'; status: 'completed' | 'rolled-back'; failedStep?: string };

export interface RunProvisionDeps {
  executor: StepExecutor;
  onEvent?: (e: ProvisionEvent) => void;
}

export interface ProvisionOutcome {
  status: 'completed' | 'rolled-back';
  failedStep?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rebink/patchwire typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/agent/provision/types.ts
git commit -m "feat(agent): add provisioning engine types"
```

---

### Task 2: planProvision (pure, TDD)

**Files:** Create `packages/cli/src/agent/provision/plan.ts`; Test `packages/cli/test/agent/provision/plan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { planProvision, elevationRequired } from '../../../src/agent/provision/plan.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';

function detected(over: Partial<DetectedServerPlatform['capabilities']> = {}): DetectedServerPlatform {
  return {
    os: 'macos',
    arch: 'arm64',
    pathStyle: 'posix',
    capabilities: {
      egress: { type: 'seatbelt', requiresElevation: false },
      filesystemIsolation: { type: 'seatbelt', requiresElevation: false },
      secrets: { type: 'keychain', requiresElevation: false },
      service: { type: 'launchd', requiresElevation: false },
      shell: { type: 'zsh', requiresElevation: false },
      packageManager: { type: 'brew', requiresElevation: false },
      ...over,
    },
  };
}

describe('planProvision', () => {
  it('produces the ordered steps for a macOS host with no elevation', () => {
    const plan = planProvision(detected());
    expect(plan.steps.map((s) => s.id)).toEqual([
      'install-claude', 'install-mutagen', 'write-secret', 'install-service', 'apply-egress', 'bind-tailnet',
    ]);
    expect(plan.steps.every((s) => s.requiresElevation === false)).toBe(true);
  });

  it('marks elevation from capabilities (linux: apt + nftables)', () => {
    const plan = planProvision(detected({
      packageManager: { type: 'apt', requiresElevation: true },
      egress: { type: 'nftables', requiresElevation: true },
      service: { type: 'systemd-user', requiresElevation: false },
    }));
    const byId = Object.fromEntries(plan.steps.map((s) => [s.id, s.requiresElevation]));
    expect(byId['install-claude']).toBe(true);
    expect(byId['apply-egress']).toBe(true);
    expect(byId['install-service']).toBe(false);
  });

  it('elevationRequired returns only the elevated steps', () => {
    const plan = planProvision(detected({ egress: { type: 'nftables', requiresElevation: true } }));
    expect(elevationRequired(plan).map((s) => s.id)).toEqual(['apply-egress']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- provision/plan`
Expected: FAIL — `plan.ts` not found.

- [ ] **Step 3: Write `packages/cli/src/agent/provision/plan.ts`**

```ts
import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { ProvisionPlan, ProvisionStep } from './types.ts';

/** Compute the ordered provisioning steps for a detected host. Pure. */
export function planProvision(d: DetectedServerPlatform): ProvisionPlan {
  const caps = d.capabilities;
  const steps: ProvisionStep[] = [
    { id: 'install-claude', title: 'Install Claude Code', requiresElevation: caps.packageManager.requiresElevation },
    { id: 'install-mutagen', title: 'Install Mutagen', requiresElevation: false },
    { id: 'write-secret', title: 'Store agent token', requiresElevation: caps.secrets.requiresElevation },
    { id: 'install-service', title: 'Install agent service', requiresElevation: caps.service.requiresElevation },
    { id: 'apply-egress', title: 'Apply egress policy', requiresElevation: caps.egress.requiresElevation },
    { id: 'bind-tailnet', title: 'Bind to tailnet', requiresElevation: false },
  ];
  return { steps };
}

/** Steps that need elevation — surfaced to the client for the consent gate. */
export function elevationRequired(plan: ProvisionPlan): ProvisionStep[] {
  return plan.steps.filter((s) => s.requiresElevation);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- provision/plan`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/provision/plan.ts packages/cli/test/agent/provision/plan.test.ts
git commit -m "feat(agent): planProvision computes ordered steps + elevation"
```

---

### Task 3: runProvision engine with compensating-action rollback (TDD)

**Files:** Create `packages/cli/src/agent/provision/run.ts`; Test `packages/cli/test/agent/provision/run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { runProvision } from '../../../src/agent/provision/run.ts';
import type { ProvisionPlan, ProvisionEvent, StepExecutor } from '../../../src/agent/provision/types.ts';

const PLAN: ProvisionPlan = {
  steps: [
    { id: 'a', title: 'A', requiresElevation: false },
    { id: 'b', title: 'B', requiresElevation: false },
    { id: 'c', title: 'C', requiresElevation: false },
  ],
};

describe('runProvision', () => {
  it('runs all steps and reports completed (no rollback)', async () => {
    const events: ProvisionEvent[] = [];
    const executor: StepExecutor = async () => ({ result: { ok: true } });
    const out = await runProvision(PLAN, { executor, onEvent: (e) => events.push(e) });
    expect(out).toEqual({ status: 'completed' });
    expect(events.filter((e) => e.type === 'step' && e.status === 'ok').length).toBe(3);
    expect(events.some((e) => e.type === 'rollback')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'done', status: 'completed' });
  });

  it('rolls back applied steps in reverse order when a step fails', async () => {
    const order: string[] = [];
    const executor: StepExecutor = async (step) => {
      if (step.id === 'c') return { result: { ok: false, detail: 'boom' } };
      return { result: { ok: true }, compensate: async () => { order.push(`undo-${step.id}`); } };
    };
    const events: ProvisionEvent[] = [];
    const out = await runProvision(PLAN, { executor, onEvent: (e) => events.push(e) });
    expect(out).toEqual({ status: 'rolled-back', failedStep: 'c' });
    expect(order).toEqual(['undo-b', 'undo-a']); // reverse order, c registered nothing
    expect(events.at(-1)).toEqual({ type: 'done', status: 'rolled-back', failedStep: 'c' });
  });

  it('treats a thrown executor as a failed step and rolls back', async () => {
    const order: string[] = [];
    const executor: StepExecutor = async (step) => {
      if (step.id === 'b') throw new Error('kaboom');
      return { result: { ok: true }, compensate: async () => { order.push(`undo-${step.id}`); } };
    };
    const out = await runProvision(PLAN, { executor });
    expect(out).toEqual({ status: 'rolled-back', failedStep: 'b' });
    expect(order).toEqual(['undo-a']);
  });

  it('does not let a failing compensation abort the rollback', async () => {
    const order: string[] = [];
    const executor: StepExecutor = async (step) => {
      if (step.id === 'c') return { result: { ok: false } };
      return {
        result: { ok: true },
        compensate: async () => {
          if (step.id === 'b') throw new Error('undo failed');
          order.push(`undo-${step.id}`);
        },
      };
    };
    const out = await runProvision(PLAN, { executor });
    expect(out.status).toBe('rolled-back');
    expect(order).toEqual(['undo-a']); // b's compensation threw but a's still ran
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- provision/run`
Expected: FAIL — `run.ts` not found.

- [ ] **Step 3: Write `packages/cli/src/agent/provision/run.ts`**

```ts
import type {
  ProvisionPlan,
  RunProvisionDeps,
  ProvisionOutcome,
  ProvisionEvent,
  CompensatingAction,
} from './types.ts';

/** Run a provisioning plan; on a step failure, roll back applied steps in reverse order. */
export async function runProvision(plan: ProvisionPlan, deps: RunProvisionDeps): Promise<ProvisionOutcome> {
  const emit = deps.onEvent ?? (() => {});
  const applied: { step: string; compensate: CompensatingAction }[] = [];

  emit({ type: 'phase', phase: 'execute' });
  for (const step of plan.steps) {
    emit({ type: 'step', step: step.id, status: 'start' });

    let outcome: { result: { ok: boolean; detail?: string }; compensate?: CompensatingAction };
    try {
      outcome = await deps.executor(step);
    } catch (err) {
      outcome = { result: { ok: false, detail: err instanceof Error ? err.message : String(err) } };
    }

    if (!outcome.result.ok) {
      emit({ type: 'step', step: step.id, status: 'failed', detail: outcome.result.detail });
      await rollback(applied, emit);
      emit({ type: 'done', status: 'rolled-back', failedStep: step.id });
      return { status: 'rolled-back', failedStep: step.id };
    }

    emit({ type: 'step', step: step.id, status: 'ok', detail: outcome.result.detail });
    if (outcome.compensate) applied.push({ step: step.id, compensate: outcome.compensate });
  }

  emit({ type: 'done', status: 'completed' });
  return { status: 'completed' };
}

async function rollback(
  applied: { step: string; compensate: CompensatingAction }[],
  emit: (e: ProvisionEvent) => void,
): Promise<void> {
  emit({ type: 'phase', phase: 'rollback' });
  for (let i = applied.length - 1; i >= 0; i--) {
    const a = applied[i]!;
    emit({ type: 'rollback', step: a.step });
    try {
      await a.compensate();
    } catch {
      /* best-effort: a failing compensation must not abort the rest of the rollback */
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- provision/run`
Expected: PASS (4 tests).

- [ ] **Step 5: Full verify**

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/provision/run.ts packages/cli/test/agent/provision/run.test.ts
git commit -m "feat(agent): runProvision engine with compensating-action rollback"
```

---

## What this slice leaves to follow-on S1 slices

- **Real step executors** — a macOS `StepExecutor` that actually installs Claude/Mutagen, writes the secret (keychain), installs the launchd service, applies egress, binds the tailnet (wiring to `daemon.ts`/`keychain.ts`/`egress.ts` + `resolveMutagen`). This is the behavior-methods slice; the engine here consumes it unchanged.
- The **consent** UI/gate (client-side; the engine already surfaces `elevationRequired(plan)`), `verify` phase, Protocol v2, and sessions.

## Self-review notes

- **Spec coverage:** Pillar 2's `plan` (planProvision + elevation surfacing for consent) and `execute → rollback` via compensating actions (runProvision) are covered; `detect` is the prior slice; real executors + `verify` are explicitly deferred.
- **Type consistency:** `ProvisionStep`/`ProvisionPlan`/`StepExecutor`/`ProvisionEvent`/`ProvisionOutcome` reused unchanged from `types.ts` across plan.ts and run.ts; `runProvision(plan, deps)` signature stable.
- **Placeholder scan:** none — the engine is complete and generic; only the concrete executors are (correctly) deferred.
