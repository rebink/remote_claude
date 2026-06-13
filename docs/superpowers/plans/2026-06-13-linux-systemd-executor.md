# Linux systemd --user service install

**Status:** in progress (2026-06-13)

**Goal:** Replace the degraded Linux `install-service` stub with a real
`systemd --user` unit, by making `patchwire-agent install`/`uninstall`
cross-platform (launchd on macOS, systemd --user on Linux). The remote executor's
Linux branch then calls `patchwire-agent install` exactly like macOS — the first
concrete step toward "proven on Linux."

**Out of scope (follow-up):** integration validation on a real Linux host; the
binary-production pipeline; Windows; nftables egress.

## Key correctness constraint

`~/.patchwire/agent.env` is written with `export VAR=val` lines (for shell
sourcing under launchd's `. ${env}`). systemd `EnvironmentFile=` CANNOT parse the
`export ` prefix. So the unit's `ExecStart` MUST source the env via a shell — the
same approach as the launchd plist — NOT `EnvironmentFile=`:

```
ExecStart=/bin/sh -lc '. <ENVFILE>; exec <AGENTBIN> serve'
```

systemd captures stdout/stderr in the journal, so no StandardOut/Err log files
(unlike launchd).

## Changes

### `packages/cli/src/commands/daemon.ts`
Refactor to dispatch by platform; reuse the shared agentBin + envFile checks.

- Extract the existing macOS body into `installLaunchd(agentBin)` / keep
  `runDaemonUninstall`'s darwin body as `uninstallLaunchd()`.
- New `const SYSTEMD_UNIT = 'patchwire-agent.service';`
  `function unitPath() { return join(homedir(), '.config/systemd/user', SYSTEMD_UNIT); }`
- New pure, exported `buildAgentUnit(agentBin: string, env: string): string` →
  ```
  [Unit]
  Description=Patchwire agent
  After=network-online.target
  Wants=network-online.target

  [Service]
  Type=simple
  ExecStart=/bin/sh -lc '. <env>; exec <agentBin> serve'
  Restart=on-failure
  RestartSec=2

  [Install]
  WantedBy=default.target
  ```
- New exported `startSystemdUser(): { ok: boolean; stderr?: string }` (analogous to
  `startLaunchAgent`): `systemctl --user daemon-reload`; `systemctl --user enable
  --now patchwire-agent.service` (its exit decides ok/stderr); then best-effort
  `loginctl enable-linger` (non-fatal — needs polkit/root; only affects survival
  across logout). All via `cp.spawnSync`.
- `runDaemonInstall`: do the agentBin + envFile checks FIRST (platform-agnostic),
  THEN dispatch: darwin → launchd path; linux → mkdir `~/.config/systemd/user`,
  write `buildAgentUnit` (mode 644), `startSystemdUser()`, log success/manage hints
  or error; else → "service install is not supported on <platform>".
- `runDaemonUninstall`: darwin → existing; linux → `systemctl --user disable --now
  patchwire-agent.service` (ignore errors), unlink unit, `systemctl --user
  daemon-reload`; warn if no unit present.

### `packages/cli/src/agent/provision/remote-executor.ts`
`install-service`: fold Linux into the existing macOS call — both run
`bash -lc 'patchwire-agent install'` with compensate `patchwire-agent uninstall`.
Keep distinct detail text ('launchd service installed' / 'systemd --user service
installed'). Windows/other stays degraded.

## Tests

`packages/cli/test/commands/daemon-systemd.test.ts` (mock `node:child_process` +
`node:fs/promises`, host-independent — does NOT call `platform()`):
- `buildAgentUnit` contains the sourcing `ExecStart=/bin/sh -lc '. <env>; exec
  <bin> serve'`, `WantedBy=default.target`, `Restart=on-failure`; and does NOT
  contain `EnvironmentFile`.
- `startSystemdUser`: spawnSync called with `systemctl --user daemon-reload` and
  `systemctl --user enable --now patchwire-agent.service`; returns `{ok:true}` on
  enable exit 0; `{ok:false, stderr}` on non-zero enable; `loginctl enable-linger`
  failure does NOT flip ok to false.

`packages/cli/test/agent/provision/remote-executor.test.ts`: replace the
"Linux: degraded" test with "Linux: installs via patchwire-agent install" —
asserts `calls[0]` matches `/patchwire-agent install/`, `result.ok` true,
`degraded` falsy, and `compensate` runs `patchwire-agent uninstall`.

## Verify
`pnpm -r typecheck` (4× Done) + `pnpm --filter @rebink/patchwire test` green.
