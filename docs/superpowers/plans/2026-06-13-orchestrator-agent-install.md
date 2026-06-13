# Fix orchestrator agent-install gap (bootstrap-agent in plan + install-claude probe + installer selection)

**Status:** in progress (2026-06-13)

**Problem:** `planProvision` emits `install-claude, install-mutagen, write-secret,
install-service, apply-egress, bind-tailnet` but NOT `bootstrap-agent`. The executor
only installs the agent under `bootstrap-agent` (→ `AgentInstaller.install`), so the
structured `provisionRemote` path (PR #47) never installs the agent — it reaches
`install-service` (`patchwire-agent install`) with nothing on PATH and fails. The
lean wizard works (installs inline); the orchestrator doesn't, end-to-end.

**Spec alignment** (`docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md`):
- line 87: `bootstrap-agent` → `AgentInstaller.install` (the agent bootstrap).
- line 89: `install-claude` → a **non-blocking probe** for the `claude` CLI; degraded
  (with an install + `claude /login` instruction) if absent. Never a blocker.

## Changes

### `packages/cli/src/agent/provision/plan.ts`
- Prepend `{ id: 'bootstrap-agent', title: 'Install Patchwire agent', requiresElevation: caps.packageManager.requiresElevation }` as the FIRST step (must precede `install-service`, which runs `patchwire-agent install`).
- Change `install-claude` to `requiresElevation: false` (it's now a probe; the install-elevation moved to `bootstrap-agent`). Keep its title 'Install Claude Code'.
- New order: `bootstrap-agent, install-claude, install-mutagen, write-secret, install-service, apply-egress, bind-tailnet`.

### `packages/cli/test/agent/provision/plan.test.ts`
- First test: id list → the 7-step order above; macOS all-elevation-false still holds.
- Linux apt test: `byId['bootstrap-agent'] === true`, `byId['install-claude'] === false`, `byId['apply-egress'] === true`, `byId['install-service'] === false`.
- `elevationRequired` (nftables egress only) test: still `['apply-egress']` (bootstrap-agent not elevated when packageManager is brew/false).

### `packages/cli/src/agent/provision/remote-executor.ts`
- `RemoteExecutorOpts`: add `binarySource?: BinaryArtifactSource`.
- Installer selection (replaces the unconditional `corepackPnpmInstaller`):
  ```ts
  const runner = opts.runner ?? defaultRemoteRunner(conn);
  const installer = opts.installer
    ?? (opts.binarySource
      ? binaryInstaller(conn, { source: opts.binarySource, detected, runner })
      : corepackPnpmInstaller(conn, runner));
  ```
  (Pass `runner` into both so the binary path is injectable/consistent.) Node-absent
  AUTO-selection is deferred — `DetectedServerPlatform` has no node signal yet (spec
  line 53 intends one); selection is keyed on `opts.binarySource` presence for now.
- New `install-claude` case (replaces the generic-degraded fallthrough): run
  `command -v claude >/dev/null 2>&1`; code 0 → `{ ok:true, detail:'claude CLI present' }`;
  else → `{ ok:true, degraded:true, detail:'Claude Code CLI not found — install it and run `claude /login` on the remote (the agent needs it to run tasks)' }`.
  (Login-state probing is fragile non-interactively; presence + the /login hint only.)

### `packages/cli/test/agent/provision/remote-executor.test.ts`
- Add: `bootstrap-agent` uses the binary installer when `opts.binarySource` is set and
  no `opts.installer` — inject a runner; source returns `{bytes,sha256(64-hex),version}`;
  assert `result.ok` and a `calls` entry containing `openssl base64 -A -d`.
- Add: `install-claude` present (`command -v claude` code 0) → ok, not degraded; absent
  (code 1) → ok + degraded + detail matches /Claude Code|claude \/login/.

## Verify
`pnpm -r typecheck` (4× Done) + `pnpm --filter @rebink/patchwire test` green.
