# apply-egress + bind-tailnet executors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the last two macOS-capable executor steps. `apply-egress` sets `PW_EGRESS=deny` in the remote `agent.env` when the host can enforce egress (else degrades, warning). `bind-tailnet` verifies the remote is on the tailnet (else degrades with guidance).

**Architecture:** Two cases in `remoteExecutor`'s switch, using the injected `RemoteRunner` and `detected.capabilities`. `apply-egress` does an idempotent tmp→rename edit of `~/.patchwire/agent.env` (so the agent enforces egress at boot via the existing seatbelt path), with a compensate that removes the line; it never sets `deny` on a host that can't enforce it (which would fail-closed the agent). `bind-tailnet` is a read-only `tailscale status` check.

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`). Modifies `agent/provision/remote-executor.ts` + its test.

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md` (§4 apply-egress, bind-tailnet; §5 fail-closed-or-warn).

---

### Task 1: apply-egress step (TDD)

**Files:**
- Modify: `packages/cli/src/agent/provision/remote-executor.ts`
- Test: `packages/cli/test/agent/provision/remote-executor.test.ts`

- [ ] **Step 1: Append failing tests** (add a small helper to build a `detected` with a chosen egress type, since the existing `detected(os)` sets egress to `none`)

```ts
function detectedWithEgress(os: DetectedServerPlatform['os'], egressType: string): DetectedServerPlatform {
  const d = detected(os);
  return { ...d, capabilities: { ...d.capabilities, egress: { type: egressType, requiresElevation: false } } };
}

describe('remoteExecutor — apply-egress', () => {
  it('sets PW_EGRESS=deny idempotently in agent.env when egress is enforceable', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detectedWithEgress('macos', 'seatbelt'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('apply-egress'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
    expect(calls[0]).toMatch(/agent\.env/);
    expect(calls[0]).toMatch(/PW_EGRESS=deny/);
    expect(calls[0]).toMatch(/grep -v .\^export PW_EGRESS=/); // idempotent: strips any prior line first
    expect(out.result.detail).toMatch(/seatbelt/);
    await out.compensate!();
    expect(calls[1]).toMatch(/grep -v .\^export PW_EGRESS=/); // compensate removes the line
    expect(calls[1]).not.toMatch(/PW_EGRESS=deny/);
  });

  it('degrades (warn) when egress is not enforceable — never sets deny on an unconfinable host', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detectedWithEgress('linux', 'none'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('apply-egress'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBe(true);
    expect(out.result.detail).toMatch(/not enforceable|without network confinement/i);
    expect(calls.length).toBe(0); // no env edit attempted
  });

  it('apply-egress reports failure (no compensate) on non-zero exit', async () => {
    const runner = async () => ({ stdout: '', stderr: 'mv failed', code: 1 });
    const exec = remoteExecutor(CONN, detectedWithEgress('macos', 'seatbelt'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('apply-egress'));
    expect(out.result.ok).toBe(false);
    expect(out.compensate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: FAIL — `apply-egress` hits the degraded default ("not yet implemented") for the enforceable case.

- [ ] **Step 3: Add the `apply-egress` case** to the switch (before `default`). Add these constants near `WRITE_ENV_CMD`:

```ts
/** Idempotently set PW_EGRESS=deny in the agent env (strip any prior line, append, tmp→rename). */
const SET_EGRESS_DENY_CMD =
  'ENV="$HOME/.patchwire/agent.env"; umask 077; { grep -v \'^export PW_EGRESS=\' "$ENV" 2>/dev/null; echo "export PW_EGRESS=deny"; } > "$ENV.tmp" && mv -f "$ENV.tmp" "$ENV"';
const UNSET_EGRESS_CMD =
  'ENV="$HOME/.patchwire/agent.env"; { grep -v \'^export PW_EGRESS=\' "$ENV" 2>/dev/null || true; } > "$ENV.tmp" && mv -f "$ENV.tmp" "$ENV"';
```
```ts
      case 'apply-egress': {
        if (detected.capabilities.egress.type === 'none') {
          return { result: { ok: true, degraded: true, detail: `egress not enforceable on ${detected.os}; agent runs without network confinement` } };
        }
        const r = await runner(SET_EGRESS_DENY_CMD);
        if (r.code !== 0) {
          return { result: { ok: false, detail: (r.stderr || r.stdout || 'apply-egress failed').trim() } };
        }
        return {
          result: { ok: true, detail: `egress: deny (enforced via ${detected.capabilities.egress.type})` },
          compensate: async () => { await runner(UNSET_EGRESS_CMD); },
        };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/provision/remote-executor.ts packages/cli/test/agent/provision/remote-executor.test.ts
git commit -m "feat(agent): apply-egress step (set PW_EGRESS=deny when enforceable, else warn)"
```

---

### Task 2: bind-tailnet step (TDD)

**Files:**
- Modify: `packages/cli/src/agent/provision/remote-executor.ts`
- Test: `packages/cli/test/agent/provision/remote-executor.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('remoteExecutor — bind-tailnet', () => {
  it('is ok when tailscale status succeeds', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('bind-tailnet'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
    expect(calls[0]).toMatch(/tailscale status/);
  });

  it('degrades with guidance when tailscale is not up', async () => {
    const runner = async () => ({ stdout: '', stderr: '', code: 1 });
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('bind-tailnet'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBe(true);
    expect(out.result.detail).toMatch(/tailscale up|tailnet/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: FAIL — `bind-tailnet` hits the degraded default with the wrong detail.

- [ ] **Step 3: Add the `bind-tailnet` case** to the switch (before `default`):

```ts
      case 'bind-tailnet': {
        const r = await runner('tailscale status >/dev/null 2>&1');
        return r.code === 0
          ? { result: { ok: true, detail: 'tailnet: up' } }
          : { result: { ok: true, degraded: true, detail: 'Tailscale is not up on the remote; the agent may be unreachable — run `tailscale up`' } };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: PASS.

- [ ] **Step 5: Full verify**

Run: `pnpm --filter @rebink/patchwire test`
Expected: 0 failed.

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/provision/remote-executor.ts packages/cli/test/agent/provision/remote-executor.test.ts
git commit -m "feat(agent): bind-tailnet step (verify tailscale, degrade with guidance)"
```

---

## What this plan leaves to the orchestrator plan

With all six steps now implemented (`bootstrap-agent`, `write-secret`, `install-mutagen`, `install-service`, `apply-egress`, `bind-tailnet`), the next plan builds the **preview + consent + non-fatal verify orchestrator** that wires `detectRemoteServerPlatform → planProvision → preview → consent → runProvision(remoteExecutor) → verify`, and refactors `runProvisionAgent` onto it.

## Self-review notes

- **Spec coverage:** §4 apply-egress (set deny when enforceable; the agent's existing seatbelt path does runtime enforcement) + §5 fail-closed-or-warn (degrade, never silently set deny on an unconfinable host); §4 bind-tailnet (verify + guide). `apply-egress` is idempotent (strips any prior line) and reversible (compensate removes the line).
- **Type consistency:** both return `{ result, compensate? }`; reuse `detected.capabilities.egress`, `opts.runner`; degraded via `StepResult.degraded`.
- **Placeholder scan:** none. The `none`-egress branch makes no env edit (asserted) so it can never weaken a host that already lacks confinement.
