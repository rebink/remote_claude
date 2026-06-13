# Provision default verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Provide `makeVerify(conn, deps)` — the real (non-fatal) verification the orchestrator runs on a completed provision: tailnet reachability (`tailscale status` on the remote) + agent `/health`, returning a `HealthReport`.

**Architecture:** `packages/cli/src/agent/provision/verify.ts`. `makeVerify` returns a `(conn, detected) => Promise<HealthReport>` matching `ProvisionRemoteDeps.verify`. Both probes are injected/overridable (a `RemoteRunner` for tailscale, an `agentHealth` thunk for the HTTP `/health` check) so it unit-tests with no SSH/network; the caller wires `agentHealth` to `AgentClient.health()`. Failures are captured into the report, never thrown (verify is non-fatal).

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`). Uses `provision-remote.ts` (HealthReport), `installer.ts` (RemoteRunner/defaultRemoteRunner), `remote-detect.ts` (RemoteConn).

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md` (§5 verify non-fatal: healthy | degraded | unhealthy).

---

### Task 1: makeVerify (TDD)

**Files:**
- Create: `packages/cli/src/agent/provision/verify.ts`
- Test: `packages/cli/test/agent/provision/verify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeVerify } from '../../../src/agent/provision/verify.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };
const DETECTED = { os: 'macos', arch: 'arm64', pathStyle: 'posix' } as unknown as DetectedServerPlatform;

describe('makeVerify', () => {
  it('reports tailnet up + agent healthy', async () => {
    const verify = makeVerify(CONN, {
      runner: async () => ({ stdout: '', stderr: '', code: 0 }),
      agentHealth: async () => ({ ok: true }),
    });
    expect(await verify(CONN, DETECTED)).toEqual({ tailnet: true, agent: 'healthy', detail: undefined });
  });

  it('reports tailnet down when tailscale status is non-zero', async () => {
    const verify = makeVerify(CONN, {
      runner: async () => ({ stdout: '', stderr: '', code: 1 }),
      agentHealth: async () => ({ ok: true }),
    });
    const r = await verify(CONN, DETECTED);
    expect(r.tailnet).toBe(false);
    expect(r.agent).toBe('healthy');
  });

  it('marks agent unhealthy when /health reports not-ok', async () => {
    const verify = makeVerify(CONN, {
      runner: async () => ({ stdout: '', stderr: '', code: 0 }),
      agentHealth: async () => ({ ok: false, detail: 'claude not found' }),
    });
    const r = await verify(CONN, DETECTED);
    expect(r.agent).toBe('unhealthy');
    expect(r.detail).toBe('claude not found');
  });

  it('captures a thrown agentHealth as unhealthy (never throws — verify is non-fatal)', async () => {
    const verify = makeVerify(CONN, {
      runner: async () => ({ stdout: '', stderr: '', code: 0 }),
      agentHealth: async () => { throw new Error('connection refused'); },
    });
    const r = await verify(CONN, DETECTED);
    expect(r.agent).toBe('unhealthy');
    expect(r.detail).toMatch(/connection refused/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- provision/verify`
Expected: FAIL — `verify.ts` not found.

- [ ] **Step 3: Write `packages/cli/src/agent/provision/verify.ts`**

```ts
import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { RemoteConn } from './remote-detect.ts';
import { defaultRemoteRunner, type RemoteRunner } from './installer.ts';
import type { HealthReport } from './provision-remote.ts';

export interface VerifyDeps {
  /** Runs `tailscale status` on the remote (default: SSH over conn). */
  runner?: RemoteRunner;
  /** Probes the agent's /health endpoint (e.g. via AgentClient over the tailnet). */
  agentHealth: () => Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Build the orchestrator's non-fatal `verify`: tailnet reachability + agent /health.
 * Never throws — any failure is captured into the report.
 */
export function makeVerify(
  conn: RemoteConn,
  deps: VerifyDeps,
): (conn: RemoteConn, detected: DetectedServerPlatform) => Promise<HealthReport> {
  const runner = deps.runner ?? defaultRemoteRunner(conn);
  return async () => {
    const ts = await runner('tailscale status >/dev/null 2>&1');
    let agent: HealthReport['agent'] = 'unknown';
    let detail: string | undefined;
    try {
      const h = await deps.agentHealth();
      agent = h.ok ? 'healthy' : 'unhealthy';
      detail = h.detail;
    } catch (err) {
      agent = 'unhealthy';
      detail = err instanceof Error ? err.message : String(err);
    }
    return { tailnet: ts.code === 0, agent, detail };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- provision/verify`
Expected: PASS (4 tests).

- [ ] **Step 5: Full verify**

Run: `pnpm --filter @rebink/patchwire test`
Expected: 0 failed.

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/provision/verify.ts packages/cli/test/agent/provision/verify.test.ts
git commit -m "feat(agent): makeVerify — non-fatal tailnet + agent /health check"
```

---

## What this plan leaves to the wiring plan

- The caller wires `agentHealth` to `new AgentClient(cfg).health()` (mapping `{ ok, claude: { found } }` → `{ ok: ok && claude.found, detail }`), and passes `makeVerify(conn, { agentHealth })` as `provisionRemote`'s `verify`.

## Self-review notes

- **Spec coverage (§5):** verify is non-fatal (captures throws → unhealthy, never rejects); reports tailnet + agent status. `unknown` remains the initial state if (hypothetically) neither path ran; here `agentHealth` is always attempted.
- **Type consistency:** returns `HealthReport` from `provision-remote.ts`; signature matches `ProvisionRemoteDeps.verify` `(conn, detected) => Promise<HealthReport>`; `RemoteRunner`/`defaultRemoteRunner` from `installer.ts`.
- **Placeholder scan:** none.
