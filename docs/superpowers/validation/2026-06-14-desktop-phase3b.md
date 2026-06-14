# Desktop Phase 3b — verification (2026-06-14)

Phase 3b (live health + remote uninstall via SSH host ops) per
`docs/superpowers/plans/2026-06-14-desktop-phase3b-host-ops.md`. Branch
`feat/desktop-phase3b-host-ops` (off `main`).

## What was verified
- **Unit tests:** CLI host-ops **7 passed** (runHostCheck: healthy/unreachable/ssh-fail/injection; runHostUninstall: ok/fail/bad-input); desktop **21 passed** (incl. 4 new `parseHostHealth`). `tsc` + `cargo check` clean.
- **Reviews (Opus):** both chunks APPROVED. **Command-injection verdict: SAFE** — `runSsh` builds an array argv (no shell); only the integer-validated `agentPort` is interpolated into the remote command string; host/user/keyPath are grammar-validated (leading-`-` rejected) and reach ssh as argv, not the shell body. Inventory + wizard + Phase-2 save-on-success preserved.
- **Live (real SSH to localhost, zero mutation):**
  - `host-check` with no agent on :7878 → `{"ok":false,"code":"unreachable","detail":"agent not reachable on the host"}` ✓
  - `host-uninstall` with nothing installed → `{"ok":false,"code":"uninstall_failed","detail":"bash: patchwire-agent: command not found"}` ✓ (graceful, no crash)
  - option-injection guard (`--host -oProxyCommand=x`) → `{"ok":false,"code":"invalid_input","detail":"unsafe host"}` ✓
- **App build + launch:** `pnpm tauri dev` builds + runs with the new commands/UI, no panic.

## Security posture
The agent stays **loopback-bound** — health is probed by SSHing to the host and curling `127.0.0.1:<port>/health`, never by exposing the agent to the network. Uninstall is key-based SSH (`patchwire-agent uninstall` via a login shell with the provisioner's PATH/pnpm env). No token/secret involved.

## Coverage rationale
- CLI host-ops (the SSH + JSON logic) are unit-tested with an injected SSH runner + confirmed live.
- `parseHostHealth` (UI badge mapping) is unit-tested.
- Rust commands + the Check/Uninstall button wiring aren't unit-testable (Tauri context) — covered by `cargo check`, `tsc`, and the live CLI run; the interactive Check/Uninstall clicks (which would mutate a real host) are left to the operator.

## Deferred
- **3b-ii:** log viewing (needs a log-viewer view + `agent-log`-over-SSH).
- **3c:** `tauri-plugin-stronghold` token storage.
- **3d:** release (bun-compiled) sidecar pipeline + code signing.
- **Windows host probing:** `host-check` uses POSIX `curl`; Windows is deferred to team validation.
- Minor (review nits, non-blocking): stale `liveHealth` entries on local Remove; uninstall-success reuses the red badge class.
