# Remote SSH Provisioning — Design Spec

**Date:** 2026-06-13
**Status:** Proposed (brainstormed + approved with revisions)
**Owner:** rebin
**Parent:** [`../../patchwire-v2-product-architecture-strategy.md`](../../patchwire-v2-product-architecture-strategy.md)
**Builds on:** `docs/specs/2026-06-12-agent-protocol-spec.md` (ServerPlatform, provisioning state machine) and the landed S1 code: `packages/cli/src/agent/server-platform/` (detection + guards) and `packages/cli/src/agent/provision/` (engine + compensating-action rollback).

## Summary

Zero-touch provisioning of the Patchwire agent on a remote host over SSH, for **any server OS** (macOS + Linux now, Windows later). The client opens the bootstrap SSH connection and drives **detect → plan → preview → consent → execute → verify**, reusing the generic `runProvision` engine (rollback already built). The only new per-OS surface is a `RemoteExecutor` that turns plan steps into remote commands through the existing `ssh-runner` (which already has `quoteForShell` + command-injection guards). It extends — does not replace — the existing `runProvisionAgent` (setup.ts) and `bootstrap-snapshot.ts`.

## Goal

A user installs a client, enters SSH host/user/key, clicks Connect, and ends up with a running, secured agent — without logging into the remote by hand. The remote's only hard prerequisite is **Node ≥ 20**.

## Scope

In scope: remote detection over SSH; the plan/preview/consent flow; the `AgentInstaller` + `RemoteExecutor` interfaces; macOS executors (full) and Linux executors (install + systemd `--user` service + file secrets); the fatal-vs-verification distinction; rollback; security.

Out of scope (phased — see Roadmap): the standalone-binary (prerequisite-free) installer implementation; Linux nftables egress enforcement; Windows executors. Their *interfaces/seams* are designed here so they plug in without reshaping the flow.

## Decisions (locked during brainstorming)

- **Any server OS now** — remote detection drives per-OS executors (macOS + Linux first).
- **Privilege:** user-level default + **consent-gated sudo per step**; macOS stays fully user-level; Linux/Windows escalate only for system service / firewall egress, and declined elevations degrade explicitly.
- **Agent bootstrap:** **Corepack + pnpm** (`pnpm add -g @rebink/patchwire`), Node ≥ 20 the only remote prerequisite; the install step sits behind an `AgentInstaller` interface so a standalone-binary installer can replace it later.

---

## Architecture

```
client ──ssh──▶ remote host
  1 detectRemote(ssh)        → DetectedServerPlatform (same shape as local detect)
  2 planProvision(detected)  → ordered steps (+ per-step requiresElevation)
  3 PREVIEW(plan)            → show every step, effect, and elevation need to the user
  4 consent(elevationRequired) → grant sudo for those steps / decline (degrade)
  5 runProvision(plan, remoteExecutor(ssh, detected)) → execute + reverse-order rollback on fatal failure
  6 verify(ssh, cfg)         → health report (healthy | degraded | unhealthy); NON-fatal
```

The orchestration is the generic `runProvision` engine already built and tested. Per-OS behavior lives only in `RemoteExecutor`. All remote commands flow through `runSsh` + `quoteForShell`.

---

## 1. Remote detection over SSH (Node-independent) — *(change 2)*

`detectRemoteServerPlatform(ssh): Promise<DetectedServerPlatform>` reuses the **pure `detectServerPlatform()`** from the landed S1 code by supplying a *remote* `DetectDeps`:

- One batched POSIX probe over SSH: `uname -sm` for platform+arch, then `command -v <tool>` for each capability tool (`sandbox-exec` `launchctl` `systemctl` `nft` `brew` `apt-get` `zsh` `secret-tool` …) **and** `node`/`corepack`/`pnpm`. Output parsed into `{ platform, arch, has() }`.
- If `uname` fails (non-POSIX shell), fall back to a PowerShell probe → Windows.
- **Detection MUST NOT depend on Node.** Node is just one more `has('node')` probe; a missing Node yields a detected platform with a `node: absent` signal, **not** a detection failure. The "is Node present / new enough" question is a *plan/preview* concern (a prerequisite check), never a precondition for detecting the host.

Result: the same `DetectedServerPlatform` whether probed locally or over SSH — `detect.ts` logic is reused verbatim; only the probe source differs.

## 2. Plan, preview, consent — *(change 1)*

- `planProvision(detected)` (already built) yields the ordered steps with per-step `requiresElevation`.
- **Preview (new):** before any consent or execution, render the full plan to the user — each step's id, human title, what it will do, whether it needs elevation, and any prerequisite gaps (e.g. "Node ≥20 required — not found"). The preview is read-only and always shown; nothing runs until the user proceeds.
- **Consent:** `elevationRequired(plan)` lists the sudo/admin steps. The user grants passwordless sudo for those, runs them manually, or declines (declined → that capability degrades explicitly).

## 3. AgentInstaller interface — *(changes 3 + 9)*

The agent-bootstrap step is behind a richer interface so the Corepack/pnpm installer and a future standalone-binary installer are interchangeable:

```ts
interface AgentInstaller {
  /** Is the agent already present on the remote? Returns its path/marker or null. */
  check(ssh: SshOpts): Promise<{ present: boolean; version?: string }>;
  /** Install the agent. Returns a result + a compensating uninstall. */
  install(ssh: SshOpts): Promise<{ result: StepResult; compensate?: CompensatingAction }>;
  /** Remove the agent (compensation / explicit uninstall). */
  uninstall(ssh: SshOpts): Promise<StepResult>;
  /** Installed version, or null if absent. */
  version(ssh: SshOpts): Promise<string | null>;
}
```

- **`CorepackPnpmInstaller`** (this spec): `corepack enable && corepack prepare pnpm@<pinned> --activate && pnpm add -g @rebink/patchwire`; `check`/`version` via `pnpm ls -g` / `patchwire --version`; `uninstall` via `pnpm remove -g`.
- **`BinaryInstaller`** (roadmap, scheduled *before* nftables/Windows): copies a per-OS-arch standalone binary over SSH; no Node needed. Same interface, drops in unchanged.

## 4. Per-OS executor steps

`remoteExecutor(ssh, detected, { token, … }): StepExecutor` dispatches each step by `detected.os`, returning `{ result, compensate? }`.

- **bootstrap-agent** → `AgentInstaller.install` (above).
- **install-mutagen** → *(change 4)* **prefer the checksum-pinned artifact**: download the pinned Mutagen release for `detected.os/arch` and verify against the sha256 manifest (the exact mechanism already in `@patchwire/core`'s resolver, reused on the remote), writing to `~/.patchwire/bin`. Package managers (brew/apt) are **not** used — pinned+verified artifacts are reproducible and supply-chain-safe. Compensation: remove the downloaded binary.
- **install-claude** → *(change 5)* **detected/degraded, never a blocker.** Probe for the `claude` CLI and its login state; if absent or not logged in, mark the agent **degraded** with a clear "install Claude Code and run `claude /login` on the remote" instruction. Provisioning still **completes**. (No auto-login — impossible non-interactively on a headless box.)
- **write-secret** → *(change 6)* **atomic write**: write the token to a temp file with mode 600, `fsync`, then `rename` into `~/.patchwire/env`. No window with wrong perms or a torn file; the token is never passed on an argv (no `ps` leak). Compensation: delete the entry.
- **install-service** → *(change 7)* macOS launchd user-agent (no root); **Linux defaults to `systemd --user`** (no root; `loginctl enable-linger` so it survives logout, itself a no-root user operation), escalating to a system unit only if explicitly chosen/consented; Windows service (consent-gated admin, roadmap). Compensation: stop + uninstall the unit.
- **apply-egress** → macOS seatbelt (no root, full). Linux nftables / Windows firewall are **consent-gated and phased** — until implemented they report **degraded** (warn-only), never silently "enforced." Compensation: remove the ruleset.
- **bind-tailnet** → verify `tailscale status`; degrade with guidance if not up.

## 5. Fatal failures vs. verification findings — *(change 8)*

The engine's `StepResult` is extended minimally:

```ts
interface StepResult { ok: boolean; degraded?: boolean; detail?: string }
```

- **Fatal** (`ok: false`): the step could not complete (e.g. agent install failed, secret couldn't be written). Triggers reverse-order **rollback** via compensating actions; provisioning ends `rolled-back`.
- **Degraded** (`ok: true, degraded: true`): the step completed but a non-critical capability isn't fully there (Claude not logged in, egress warn-only). **No rollback** — collected into the outcome's `degraded[]` and surfaced.
- **Verify phase** is separate and **non-fatal**: it produces a health report `healthy | degraded | unhealthy` from `tailscale status` + agent `/health` (claude found/login). An unhealthy result is **reported, not auto-rolled-back** — a successful install with a failed health check is debuggable and must not be destroyed automatically.

So the outcome is `{ status: 'completed' | 'rolled-back'; failedStep?; degraded: string[]; health?: HealthReport }`.

## 6. Rollback & security

- **Rollback:** reuse `runProvision`'s reverse-order, best-effort, throw-tolerant compensation (already built + tested). Each executor step supplies its inverse.
- **Security:** every interpolated value passes `quoteForShell`; the existing **command-injection guard** (reject shell-metachar host/user) is kept and extended to all user-controlled inputs; token via atomic mode-600 file, **never argv**; tailnet-only binding; `IdentitiesOnly=yes`; egress **fail-closed or warn, never silently downgrade** (reuses the S1 capability guards).

## 7. Reconciliation with existing code (strangler, not rewrite)

- `runProvisionAgent` (setup.ts) → becomes the macOS `RemoteExecutor` + `verify`, now driven by `runProvision` + remote detection — gaining the rollback, consent, preview, and OS-awareness it lacks today. Its injection guard and `bash -lc` login-shell handling carry over.
- `bootstrap-snapshot.ts` (remote mkdir+rsync+git) → unchanged; project-bootstrap is a separate concern from agent provisioning.
- `ssh-runner.ts` (`runSsh` + `quoteForShell` + guards) → the transport, reused.

## 8. Roadmap (implementation slices) — *(change 9)*

1. **Detection-over-SSH + `RemoteExecutor`/`AgentInstaller` interfaces + macOS executors** — refactor `runProvisionAgent` onto the engine; full preview/consent/rollback. Ships macOS zero-touch properly.
2. **Linux executors** — Corepack/pnpm install, **systemd `--user`** service, file secrets, checksum-pinned Mutagen. Egress stays degraded/warn-only.
3. **`BinaryInstaller`** — standalone-binary, prerequisite-free install (no Node). *(Moved ahead of nftables/Windows — broadens reach with less risk.)*
4. **Linux nftables egress** (the hard security piece) + **Windows executors**.

## 9. Components / files (anticipated)

- `packages/cli/src/agent/provision/remote-detect.ts` — `detectRemoteServerPlatform(ssh)` (remote `DetectDeps` → pure `detectServerPlatform`).
- `packages/cli/src/agent/provision/installer.ts` — `AgentInstaller` interface + `CorepackPnpmInstaller`.
- `packages/cli/src/agent/provision/remote-executor.ts` — `remoteExecutor(ssh, detected, opts)` per-OS step dispatch.
- `packages/cli/src/agent/provision/verify.ts` — non-fatal health report.
- `packages/cli/src/agent/provision/preview.ts` — render plan preview.
- Extend `provision/types.ts` `StepResult` with `degraded?`; extend `ProvisionOutcome` with `degraded[]` + `health?`.
- Reuse: `provision/plan.ts`, `provision/run.ts`, `server-platform/detect.ts`, `server-platform/guards.ts`, `lib/ssh-runner.ts`.

## Open questions (tracked, not blocking)

- Exact remote Mutagen-artifact extraction on the remote (reuse core's extractor via the agent, or a self-contained remote download script) — resolved in the slice-1 plan.
- `loginctl enable-linger` availability detection (some minimal Linux images lack it) — fall back to a documented manual step.
- Whether `verify`'s unhealthy result should offer an opt-in rollback (default: no).

## Testing approach

- Pure pieces (`planProvision`, detection mapping, preview rendering, fatal-vs-degraded aggregation) — unit-tested with injected probes/executors (no real SSH).
- `RemoteExecutor`/`AgentInstaller` — unit-tested via a mock `SshOpts` adapter asserting the remote command strings (argv), reusing the existing `setup-provision-agent.test.ts` pattern (it already asserts `bash -lc` + the install command + injection refusal).
- Rollback ordering — already covered by `provision/run.test.ts`.
