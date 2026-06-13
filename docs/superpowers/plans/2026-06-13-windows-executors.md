# Windows executors (B2)

**Status:** in progress (2026-06-13)

**Goal:** Make remote provisioning complete on a Windows host. After B1 (detection),
the executor's non-critical steps already degrade gracefully on Windows (their POSIX
commands fail → non-fatal degraded), and `apply-egress` already returns degraded
(egress=none). The remaining gaps:
- **bootstrap-agent** — hard-fails on Windows today (fatal).
- **write-secret** — runs the POSIX `WRITE_AGENT_ENV_CMD` (fails on cmd.exe → fatal).
- **install-service** — degraded (no autostart).

**Validation note:** No Windows host here. Implemented + unit-tested for command
SHAPE (the tests prove the builders emit the intended strings, NOT that they run on
Windows). Real-Windows validation is the team's. Each command documents its
assumptions; a "Windows validation checklist" is in the PR.

## Design choices (for team validation)
- **Service = per-user Scheduled Task at logon** (`schtasks /SC ONLOGON`), NOT a
  system service via `sc.exe` — keeps the "user-level default, no admin" principle,
  consistent with macOS launchd (gui) and Linux systemd `--user` (both session-bound).
  → `detect.ts` Windows `service` capability becomes `{ type: 'schtasks', requiresElevation: false }`.
- **Env on Windows:** `agent.env` keeps the same `export KEY=val` content; a PowerShell
  **launcher** parses it (strips `export`, trims quotes), sets `$env:`, then runs
  `patchwire-agent serve`. Mirrors how launchd/systemd source the env via a shell.
- **Quoting:** PowerShell commands use single quotes + `Join-Path` (no nested `"`); the
  launcher is written to a `.ps1` file and invoked via `-File` so `schtasks /TR` needs
  no inline PS quoting.

## Changes

### NEW `packages/cli/src/agent/provision/windows-primitives.ts`
- `WRITE_AGENT_ENV_PS` — `powershell -NoProfile -Command "<script>"` that reads the env
  content from stdin and writes `%USERPROFILE%\.patchwire\agent.env`:
  ```
  $d=Join-Path $env:USERPROFILE '.patchwire'; New-Item -ItemType Directory -Force -Path $d > $null; Set-Content -LiteralPath (Join-Path $d 'agent.env') -Value ([Console]::In.ReadToEnd()) -NoNewline -Encoding ascii; Write-Output PW_ENV_OK
  ```
- `REMOVE_AGENT_ENV_PS` — `Remove-Item` the env file (`-ErrorAction SilentlyContinue`) — write-secret's compensator.
- Exported path consts for the agent dir / launcher.

### `packages/cli/src/agent/provision/remote-executor.ts`
- `bootstrap-agent`: remove the Windows hard-fail; let the selected installer run
  (Windows + Node → corepack works over cmd; Windows + no Node → binary path, B3).
- `write-secret`: when `detected.os === 'windows'`, run `WRITE_AGENT_ENV_PS` (payload via
  stdin) and compensate with `REMOVE_AGENT_ENV_PS`; else the existing POSIX path.
- `install-service`: add a Windows branch that runs `patchwire-agent install` directly
  (NOT `bash -lc …`), compensate `patchwire-agent uninstall`.

### `packages/cli/src/commands/daemon.ts` (runs ON the remote)
- A Windows branch in `runDaemonInstall`/`runDaemonUninstall`:
  - resolve the agent bin with `where.exe` (the POSIX `command -v`/`/bin/sh` path
    doesn't exist on Windows).
  - write `%USERPROFILE%\.patchwire\bin\agent-launcher.ps1` (the env-sourcing launcher,
    pure `buildAgentLauncherPs1()` builder).
  - `schtasks /Create /F /TN PatchwireAgent /SC ONLOGON /TR "powershell -NoProfile -File <launcher>"` then `/Run`.
  - uninstall: `schtasks /Delete /F /TN PatchwireAgent` + remove the launcher.
- macOS/Linux branches unchanged.

### `detect.ts` — Windows `service` → `{ type: 'schtasks', requiresElevation: false }`. Update the detect.test Windows assertion.

## Tests (command-shape, host-independent)
- `windows-primitives`: `WRITE_AGENT_ENV_PS` contains `powershell -NoProfile -Command`, `Join-Path`, `agent.env`, `[Console]::In.ReadToEnd()`; `buildAgentLauncherPs1` parses `export KEY=val`, runs `patchwire-agent serve`.
- executor: write-secret on Windows runs the PS command with the payload + compensator; bootstrap-agent on Windows delegates to the installer (no longer fatal); install-service Windows runs `patchwire-agent install` + compensate.
- daemon: a Windows-path test for `buildAgentLauncherPs1` + schtasks command shape (extract a pure `buildSchtasksCreate(launcherPath)` to test without spawning).
- detect: Windows `service.type === 'schtasks'`.

## Verify
`pnpm -r typecheck` (4× Done) + `pnpm --filter @rebink/patchwire test` green.
