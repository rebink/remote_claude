# install-service + install-mutagen executors Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `install-service` and `install-mutagen` steps to `remoteExecutor`. `install-service` delegates to the now-service-only `patchwire-agent install` on macOS (Linux/Windows report degraded); `install-mutagen` is a presence-check that degrades gracefully (the agent resolves Mutagen lazily via the core resolver).

**Architecture:** Both are cases in `remoteExecutor`'s switch, using the injected `RemoteRunner`. macOS `install-service` runs `bash -lc 'patchwire-agent install'` (login shell so the just-installed CLI is on PATH) with compensate `patchwire-agent uninstall`. Linux/Windows `install-service` and a missing Mutagen are **degraded** (non-fatal) — honest interim per the roadmap (Linux systemd `--user` is its own later slice).

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`). Modifies `agent/provision/remote-executor.ts` + its test.

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md` (§4). Depends on Plan A (service-only `daemon.ts`).

---

### Task 1: install-mutagen step (presence → ok/degraded) (TDD)

**Files:**
- Modify: `packages/cli/src/agent/provision/remote-executor.ts`
- Test: `packages/cli/test/agent/provision/remote-executor.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('remoteExecutor — install-mutagen', () => {
  it('is ok when mutagen is already present on the remote', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('install-mutagen'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
    expect(calls[0]).toMatch(/command -v mutagen|\.patchwire\/bin\/mutagen/);
  });

  it('is degraded (non-fatal) when mutagen is absent — the agent resolves it lazily', async () => {
    const runner = async () => ({ stdout: '', stderr: '', code: 1 });
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('install-mutagen'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBe(true);
    expect(out.result.detail).toMatch(/resolve|first sync/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: FAIL — `install-mutagen` hits the degraded default with a "not yet implemented" detail (wrong detail / no presence command run).

- [ ] **Step 3: Add the `install-mutagen` case** to the switch in `remote-executor.ts` (before `default`):

```ts
      case 'install-mutagen': {
        const present = await runner('command -v mutagen >/dev/null 2>&1 || test -x "$HOME/.patchwire/bin/mutagen"');
        return present.code === 0
          ? { result: { ok: true, detail: 'mutagen present on remote' } }
          : { result: { ok: true, degraded: true, detail: 'mutagen not present; the agent will resolve it on first sync' } };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/provision/remote-executor.ts packages/cli/test/agent/provision/remote-executor.test.ts
git commit -m "feat(agent): install-mutagen step (presence check, degrades to lazy resolve)"
```

---

### Task 2: install-service step (macOS real; Linux/Windows degraded) (TDD)

**Files:**
- Modify: `packages/cli/src/agent/provision/remote-executor.ts`
- Test: `packages/cli/test/agent/provision/remote-executor.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('remoteExecutor — install-service', () => {
  it('macOS: installs the launchd service via service-only patchwire-agent install, with compensate', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detected('macos'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('install-service'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
    expect(calls[0]).toMatch(/patchwire-agent install/);
    expect(calls[0]).not.toMatch(/--token/); // token lives in agent.env, not argv
    await out.compensate!();
    expect(calls[1]).toMatch(/patchwire-agent uninstall/);
  });

  it('macOS: reports failure (no compensate) on non-zero exit', async () => {
    const runner = async () => ({ stdout: '', stderr: 'launchctl failed', code: 1 });
    const exec = remoteExecutor(CONN, detected('macos'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('install-service'));
    expect(out.result.ok).toBe(false);
    expect(out.compensate).toBeUndefined();
  });

  it('Linux: degraded (systemd --user not yet wired)', async () => {
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner: async () => ({ stdout: '', stderr: '', code: 0 }) });
    const out = await exec(step('install-service'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBe(true);
    expect(out.result.detail).toMatch(/linux|systemd/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: FAIL — `install-service` falls into the degraded default for all OSes.

- [ ] **Step 3: Add the `install-service` case** to the switch (before `default`):

```ts
      case 'install-service': {
        if (detected.os === 'macos') {
          const r = await runner("bash -lc 'patchwire-agent install'");
          if (r.code !== 0) {
            return { result: { ok: false, detail: (r.stderr || r.stdout || 'service install failed').trim() } };
          }
          return {
            result: { ok: true, detail: 'launchd service installed' },
            compensate: async () => { await runner("bash -lc 'patchwire-agent uninstall'"); },
          };
        }
        if (detected.os === 'linux') {
          return { result: { ok: true, degraded: true, detail: 'linux service install (systemd --user) not yet wired; run the agent manually' } };
        }
        return { result: { ok: true, degraded: true, detail: `service install not yet supported on ${detected.os}` } };
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
git commit -m "feat(agent): install-service step (macOS launchd; linux/windows degraded)"
```

---

## What this plan leaves to follow-on plans

- `apply-egress` (seatbelt on macOS; Linux nftables / Windows degraded) and `bind-tailnet` executor steps.
- The **preview + consent + non-fatal verify orchestrator** that wires `detectRemote → planProvision → preview → consent → runProvision(remoteExecutor) → verify`, then refactors `runProvisionAgent` to use it.
- **Linux executors** slice: real systemd `--user` service unit (replacing the degraded stub here).

## Self-review notes

- **Spec coverage (§4):** `install-mutagen` (presence/degraded, lazy-resolve honesty) and `install-service` (macOS launchd via the service-only `patchwire-agent install` from Plan A; Linux/Windows degraded) are covered. `--token` is asserted absent (env ownership is write-secret's). `apply-egress`/`bind-tailnet`/orchestrator deferred.
- **Type consistency:** both cases return the `{ result, compensate? }` shape; reuse `opts.runner`/`detected.os` already in `remoteExecutor`; degraded uses the `StepResult.degraded` field from the engine extension.
- **Placeholder scan:** none — degraded details are honest interim states, not stubs to fill.
