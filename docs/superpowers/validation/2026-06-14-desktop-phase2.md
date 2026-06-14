# Desktop Phase 2 — verification (2026-06-14)

Phase 2 (wizard UX + token-via-stdin + host persistence) per
`docs/superpowers/plans/2026-06-14-desktop-phase2-wizard.md`. Branch `feat/desktop-phase2-wizard`
(stacked on #59 → #58 → main).

## What was verified

- **Unit tests:** CLI `setup-provision-remote` suite **20 passed** (incl. token-stdin read + malformed→invalid_input + 3 persistent-line-reader cases). Desktop **13 passed** (stage-sidecar 6, provision-state 6, host-record 1). `tsc --noEmit` clean (CLI + desktop). `cargo check` clean.
- **Live token-stdin contract (decline path, zero mutation):** ran the bundled dev sidecar with
  `setup --provision-remote --stream --token-stdin` against `127.0.0.1`, piping **both** lines at once
  (`{"token":…}\n{"consent":false}\n`) to exercise the new persistent line reader:
  - read the token from stdin (no `--token` on argv),
  - emitted `preview`,
  - read the consent line from the retained buffer (the coalesced-chunk case the reader now handles),
  - emitted `{"type":"result","status":"cancelled"}`.
  - No `com.patchwire.agent` launchd afterward — zero mutation. ✓
- **App build + launch:** `pnpm tauri dev` rebuilt and launched the updated app (wizard UI + `save_host`)
  without panic. (cargo check was already clean on this exact code; launch parity with Phase 1.)

## Security hardening landed this phase
- Agent token removed from process argv — now passed over the sidecar's stdin (`--token-stdin`),
  validated both at the Rust boundary and by the CLI's `unsafeProvisionField`.
- Persistent per-stream line reader (`makeLineReader`) — fixes a latent lost-line bug now that
  `--stream` reads two stdin lines (token then consent).

## Coverage rationale
- The Tauri sidecar spawn/stream/stdin mechanics were proven in the spike PoC + Phase 1.
- The two TDD'd units this phase (reducer per-step status; pure host-record) are unit-tested.
- The token-stdin contract is unit-tested (CLI) and re-confirmed live here.
- Host persistence: `buildHostRecord` is unit-tested (asserts the token is never persisted); the
  `save_host` fs write is structured + cargo-checked. The interactive "Provision → Approve → host saved"
  click-through mutates the host and is left to the operator; the execute path itself is already
  validated (`2026-06-13-macos-arm-wave1.md`).

## Deferred to Phase 3
Inventory UI (list/health-badges/logs/uninstall/re-run); `tauri-plugin-stronghold` token storage;
release (bun-compiled) sidecar + code signing. Minor fs-robustness follow-ups noted in review
(corrupted `hosts.json` is currently discarded rather than backed up).
