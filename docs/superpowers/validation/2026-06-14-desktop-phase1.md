# Desktop Phase 1 — verification (2026-06-14)

Phase 1 (Tauri skeleton + sidecar plumbing) per `docs/superpowers/plans/2026-06-14-desktop-phase1-tauri-skeleton.md`.
Branch `feat/desktop-phase1-tauri-skeleton` (stacked on #58 → main).

## What was verified

- **Unit tests:** `pnpm --filter patchwire-desktop test` → 10/10 (6 sidecar-staging mapping + 4 provision reducer). `tsc --noEmit` clean. `cargo check` clean.
- **Live sidecar contract (decline path, zero mutation):** ran the exact bundled dev sidecar
  (`src-tauri/binaries/patchwire-aarch64-apple-darwin`, a wrapper over the real CLI) with
  `setup --provision-remote --stream` against `127.0.0.1`, piping `{"consent":false}`:
  - emitted the `preview` NDJSON line (full 7-step plan, real SSH detect+plan),
  - read the consent line from stdin,
  - emitted `{"type":"result","status":"cancelled",...}`.
  - No agent installed afterward (no `com.patchwire.agent` launchd; `:7878` free). ✓
- **Real app build + launch:** `pnpm tauri dev` built (36.95s) and reached
  `Running target/debug/desktop` with no panic/error; shell plugin + `start_provision`/`send_consent`
  commands registered. Window opened; killed after launch confirmation.

## Coverage rationale (why this is sufficient for Phase 1)
- Tauri's sidecar spawn → line-buffered stdout events → stdin consent write was proven end-to-end in
  the spike PoC (`2026-06-13-tauri-spike-findings.md`).
- The UI's NDJSON→state logic is unit-tested (the reducer).
- The real CLI's `--stream`/consent contract is unit-tested (Phase 0, PR #58) and re-confirmed live here.
- The remaining gap — a human clicking **Provision → Approve** for a real *execute* — mutates the host;
  it is left to interactive use. The execute path itself was already validated on real macOS hardware
  (`2026-06-13-macos-arm-wave1.md`); the desktop app only renders those same events.

## Known notes / follow-ups
- Detection shows `node.present:false` on this Mac **only because this branch predates #55's PATH fix**
  (it's stacked on #58→main). Correct once #55 merges and branches integrate.
- Security review of the Rust commands was addressed: input validation (option-injection defense),
  atomic in-progress guard (TOCTOU closed), `~/` key-path expansion. Deferred (Phase 2): pass the
  agent token via stdin/env instead of argv (local `ps` exposure; matches the current CLI pattern).
- Bundle binary is named `desktop` (Cargo crate name); `productName`/window title are `Patchwire`.
  Cosmetic — revisit when packaging (Phase 2/3).

## To try the GUI yourself
```
export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
cd packages/desktop && pnpm tauri dev
# Form: host 127.0.0.1, user <you>, keyPath ~/.ssh/pw_validate → Provision → Approve (mutates) or Cancel (safe)
```
