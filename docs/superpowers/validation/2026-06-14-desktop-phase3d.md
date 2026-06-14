# Desktop Phase 3d-i — verification (2026-06-14)

Phase 3d-i (unsigned cross-OS release pipeline) per
`docs/superpowers/plans/2026-06-14-desktop-phase3d-release.md`. Merged to `main` via #67 (pipeline) + #68 (CI fixes).

## What was verified
- **Local (TDD + dry-run):** `build-cli-binaries` 5 tests (target table + `selectTargets` native-only filter); `stage-sidecar` 11 tests (name→triple incl. CLI assets); a fake-file `--from-release` staging maps the 3 triples; YAML/JSON parse.
- **CI — the gating check, all green** ([run 27493110210](https://github.com/rebink/remote_claude/actions/runs/27493110210), `workflow_dispatch`, no publish):
  - macOS (aarch64-apple-darwin) → `.app` + `.dmg` — artifact 57 MB ✓
  - Linux (ubuntu-22.04, x86_64) → `.deb` + `.rpm` — artifact 168 MB ✓
  - Windows (x86_64-msvc) → nsis `.exe` — artifact 29 MB ✓

## First-run failures found + fixed (#68)
- **Windows:** `bun --compile` cross-compiling the darwin target failed ("failed to extract executable for bun-darwin-aarch64"). macOS cross-compiles fine; Windows does not. Fix: each runner builds **only its native** target (`build-cli-binaries.mjs --only <bun-target>` + per-runner `bunTarget` matrix field).
- **Linux:** `.deb`+`.rpm` built; the **AppImage** bundler (`linuxdeploy`) failed (a common CI flake). Fix: `tauri.conf` bundle targets restricted to `["deb","rpm","app","dmg","nsis"]` — AppImage dropped.

## How it works
`desktop-release.yml` (manual `workflow_dispatch`, 3-OS matrix, `fail-fast:false`): each runner builds its native CLI binary (bun `--compile`) → `stage-sidecar --from-release` names it `patchwire-<triple>` → `tauri build` (unsigned) → installers uploaded as `patchwire-desktop-<triple>` artifacts. **No npm/marketplace publish** — `release.yml` (tag-triggered) is untouched. Safe to re-run anytime.

## Distribution note (unsigned)
Installers are **unsigned** — fine for internal testers: macOS → right-click → Open (or `xattr -dr com.apple.quarantine`); Windows → SmartScreen "More info → Run anyway"; Linux deb/rpm install normally.

## Deferred — 3d-ii (needs your certs)
macOS Developer-ID signing + notarization; Windows code-signing; wiring the desktop build into the tagged `release.yml` (so a version tag also publishes signed installers). Also 3c (stronghold token storage). Windows-arm64 + Linux-arm64 desktop builds not in the matrix yet.
