# Desktop Phase 3b-ii — verification (2026-06-14)

Phase 3b-ii (host log viewer over SSH) per
`docs/superpowers/plans/2026-06-14-desktop-phase3b-ii-logs.md`. Branch
`feat/desktop-phase3b-ii-logs` (off `main`).

## What was verified
- **Unit tests:** CLI host-ops **12 passed** (incl. 5 new `runHostLogs`: parse-entries, empty→[], ssh-fail→log_failed, limit-default/clamp, bad-input-no-ssh); desktop **26 passed** (incl. 5 new `host-logs` helper tests). `tsc` + `cargo check` clean.
- **Reviews (Opus):** both chunks APPROVED. `limit` interpolation confirmed **injection-safe** (Number.isInteger + range ≤1000, else literal 100). Wizard + inventory (Check/Re-run/Remove/Uninstall + live badges) preserved.
- **Live (real SSH to localhost):**
  - `host-logs` with no agent installed → `{"ok":false,"code":"log_failed","detail":"bash: patchwire-agent: command not found"}` ✓ (graceful; confirms the error surfaces via JSON on stdout, so the UI shows an error rather than "no entries").
  - injection guard (`--host -x`) → `{"ok":false,"code":"invalid_input","detail":"unsafe host"}` ✓
- **App build + launch:** `pnpm tauri dev` builds + runs with the 'logs' view, no panic.

## Behavior
- Uses the agent's own `patchwire-agent log --json --limit N` over SSH (reads `~/.patchwire/agent.log`); the agent stays loopback-bound (no network exposure). Point-in-time fetch of the last N (default 100) entries.
- UI: a **Logs** button on each host card opens a 'logs' view (Back-to-hosts nav) rendering `ts  user  project  route` lines, with loading/error/empty states.

## Coverage rationale
- `runHostLogs` (SSH + NDJSON parse) is unit-tested w/ injected SSH + confirmed live; `parseHostLogs`/`formatLogEntry` unit-tested. Rust command + UI wiring covered by cargo check, tsc, the live CLI run; interactive Logs-button click left to the operator.

## Deferred
- Live tailing/streaming (this is point-in-time last-N).
- **3c:** `tauri-plugin-stronghold` token storage. **3d:** release sidecar + code signing.
- Windows host log-fetch (POSIX `bash -lc`); deferred with the other Windows host-probing.
- Minor (review, non-blocking): `host_logs` Rust drops sidecar stderr on a nonzero process exit (moot — the CLI always exits 0 with JSON); `limit` hardcoded to 100 in the UI.
