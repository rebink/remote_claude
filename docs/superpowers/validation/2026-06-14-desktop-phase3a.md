# Desktop Phase 3a — verification (2026-06-14)

Phase 3a (host inventory: list / re-run / remove) per
`docs/superpowers/plans/2026-06-14-desktop-phase3a-inventory.md`. Branch
`feat/desktop-phase3a-inventory` (stacked on #60 → #59 → #58 → main).

## What was verified
- **Unit tests:** desktop **17 passed** (stage-sidecar 6, provision-state 6, host-record 1, inventory 4 — the new `recordToFormValues` + `hostBadge` cases). `tsc --noEmit` clean. `cargo check` clean (`list_hosts` + `delete_host`).
- **Review (Opus):** APPROVED — no Critical/Important issues; the Phase-2 wizard rendering + save-on-success logic confirmed intact after the `main.ts` restructure; `h()` is XSS-safe (no `innerHTML` of host labels); `delete_host` uses `id` only for an in-array filter (constant file path, no traversal).
- **Seeded run:** wrote a sample `~/Library/Application Support/com.patchwire.desktop/hosts.json` (one host) and launched the app — it builds and launches with the inventory code, no panic.

## Coverage rationale
- `list_hosts`/`delete_host` IO mirrors the Phase-2 `save_host` (already proven to read/write `hosts.json`).
- The two decision functions (`recordToFormValues`, `hostBadge`) are unit-tested.
- The interactive click-through — **Hosts** tab → card renders → **Re-run** prefills the wizard → **Remove** deletes — opens a GUI window and can't be driven headlessly; it's left to the operator. The rendering path is plain `h()` over the unit-tested helpers + the cargo-checked commands.

## Scope (deferred, by design)
- **3b:** live SSH-based health re-check, log viewing, remote uninstall (the agent binds the host loopback, so these need SSH, not a direct probe — i.e. a `doctor --json`/`agent-log`-over-SSH path).
- **3c:** `tauri-plugin-stronghold` token storage.
- **3d:** release (bun-compiled) sidecar pipeline + code signing/notarization.

## To try it yourself
```
export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
cd packages/desktop && pnpm tauri dev
# Click "Hosts" → the seeded card → Re-run (prefills Provision form) / Remove (deletes the record)
```
