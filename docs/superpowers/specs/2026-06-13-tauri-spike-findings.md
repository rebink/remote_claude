# Tauri spike — findings (desktop Phases 1–3 de-risk)

**Date:** 2026-06-13 · **Source:** official Tauri v2 docs (`/tauri-apps/tauri-docs`) · **Outcome:** all three open
questions from the desktop spec are resolved on paper; the sidecar I/O model maps 1:1 to the Phase 0 CLI contract.

## Q1 — Sidecar binary naming + spawning/streaming — RESOLVED

- **Config:** `tauri.conf.json` → `"bundle": { "externalBin": ["binaries/patchwire"] }`.
- **Naming:** each binary needs a **`-$TARGET_TRIPLE` suffix**. The triple comes from `rustc --print host-tuple`.
  Examples: macOS ARM `patchwire-aarch64-apple-darwin`, macOS Intel `patchwire-x86_64-apple-darwin`,
  Linux x64 `patchwire-x86_64-unknown-linux-gnu`, Windows x64 `patchwire-x86_64-pc-windows-msvc.exe`.
- **Required build step:** map our **bun** target names → Tauri **triples** (a small rename/copy in the build):
  | bun target | Tauri sidecar name |
  |---|---|
  | darwin-arm64 | `patchwire-aarch64-apple-darwin` |
  | darwin-x64 | `patchwire-x86_64-apple-darwin` |
  | linux-x64 | `patchwire-x86_64-unknown-linux-gnu` |
  | linux-arm64 | `patchwire-aarch64-unknown-linux-gnu` |
  | windows-x64 | `patchwire-x86_64-pc-windows-msvc.exe` |
  | windows-arm64 | *(not built — documented gap)* |
- **Spawn + stream (Rust, `tauri_plugin_shell`):** `app.shell().sidecar("patchwire").spawn()` returns `(rx, child)`.
  `rx.recv()` yields `CommandEvent::Stdout(line_bytes)` **line-by-line** → emit to the webview; `child.write(b"...\n")`
  writes to the sidecar's **stdin**.

  ```rust
  let (mut rx, mut child) = app.shell().sidecar("patchwire").unwrap()
      .args(["setup","--provision-remote","--stream","--host",host,/*…*/])
      .spawn().expect("spawn");
  tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
      if let CommandEvent::Stdout(bytes) = event {
        app.emit("pw://prov-event", String::from_utf8_lossy(&bytes)).ok(); // one NDJSON line → UI
      }
    }
  });
  // on Approve from the UI: child.write(b"{\"consent\":true}\n").unwrap();
  ```

  **This is an exact fit for Phase 0's contract:** line-buffered stdout = our NDJSON-per-event; `child.write` =
  our `{"consent":…}` stdin line. No CLI changes needed; the seam we built is directly consumable.

## Q2 — Secret storage — RESOLVED (spec amended)

- The first-party Tauri secret store is **`tauri-plugin-stronghold`**: an **encrypted file vault** (`vault.hold` in
  app-data) protected by a password + a 32-byte password-hash function. It is **uniform across mac/linux/windows**
  (no per-OS keychain quirks). There is no first-party "OS keychain" plugin.
- **Decision:** use **stronghold**, not a per-OS keychain. It is the cross-platform encrypted store the spec wanted
  as the "fallback," promoted to the primary — simpler and first-party. The agent token is stored in the vault keyed
  by host `id`; `hosts.json` stays secret-free.
- **Remaining detail (for the plan):** vault-password management. v1 approach: generate a random vault key on first
  run and persist it via the OS keychain *if a community keyring plugin is added later*; for the MVP, derive/store an
  app-managed key (acceptable for an internal-team console). Not a blocker.

## Q3 — Linux WebKitGTK — RESOLVED

- Tauri v2 needs **WebKitGTK 4.1** (`libwebkit2gtk-4.1-dev`). Ubuntu 22.04+ / Debian 12+ / Fedora (`webkit2gtk4.1-devel`)
  / Arch (`webkit2gtk-4.1`) ship it in standard repos.
- **glibc caveat:** build on the **oldest** base you support (Ubuntu 22.04 / Debian 12) or risk
  `GLIBC_2.xx not found` at runtime on older machines. Tauri recommends building Linux in **Docker / GitHub Actions**.
- **Not a blocker** — a documented system-dep + a build-environment discipline (CI on ubuntu-22.04). macOS prereq:
  Xcode CLT. Windows prereq: MS C++ Build Tools + Edge WebView2 (ships with modern Windows).

## Toolchain status (this dev Mac)
- **Rust/Cargo: ABSENT** — Tauri's hard prerequisite (install via `rustup`). Node 26 + pnpm 10 present. `bun` absent
  (so the sidecar binaries are produced in CI, not locally — consistent with the existing release pipeline).
- A local empirical PoC (scaffold + spawn + stream + consent) requires installing the Rust toolchain. The docs above
  already prove the pattern matches our contract, so the PoC is **confidence-additive, not decision-blocking**.

## Net result for the Phase 1–3 plan
- **Stack confirmed:** Tauri v2 + `tauri-plugin-shell` (sidecar) + `tauri-plugin-stronghold` (secrets) + vanilla-TS UI.
- **New build step:** bun-target → Tauri-triple sidecar rename (small script; CI produces the per-OS binaries).
- **Linux:** build in CI on an Ubuntu 22.04 base; ship AppImage/deb.
- **No further CLI work needed** — Phase 0's `--stream`/stdin-consent is the exact interface the Rust shell drives.
- **Open micro-decision deferred to the plan:** stronghold vault-password strategy for v1.
