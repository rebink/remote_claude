# Unified release version sync — design

**Date:** 2026-06-18
**Status:** Approved (brainstorm), pre-implementation
**Supersedes:** the desktop-only `release:desktop` version-sync (PR #72) — that tooling is generalized here.

## Problem

Published artifact versions have drifted apart and there is no single command or
single source of truth that keeps them equal:

| Artifact | repo `package.json` | actually published |
| --- | --- | --- |
| VS Code extension (Marketplace / Open VSX / GitHub `.vsix`) | 0.4.0 | **0.3.18** |
| CLI `@rebink/patchwire` (npm) | 0.4.0 | **0.3.17** |
| Desktop installers (Tauri) | 0.4.0 | **0.4.0** |
| `packages/desktop/src-tauri/Cargo.toml` | — | **0.1.0** (never bumped) |

Two independent release lines cause this:

- `v*.*.*` → `.github/workflows/release.yml` → CLI (npm) + extension (Marketplace/Open VSX) + `.vsix` + standalone agent binaries.
- `desktop-v*` → `.github/workflows/desktop-release.yml` → desktop installers (`.dmg`/`.exe`/`.deb`/`.rpm`) + `SHASUMS256.txt`.

Each line bumps versions by hand, on its own cadence, with no guard tying them together.

## Goal

**One version → one command → one tag → one workflow → one GitHub release.**
Every shippable artifact carries the same semver, enforced in CI so it can never
drift again.

## Decisions (locked during brainstorm)

1. **Release model:** one tag ships everything. A single `pnpm release X.Y.Z`
   bumps every version field, and CI builds + publishes CLI, extension, and
   desktop installers from that one tag into one GitHub release.
2. **Tag scheme:** `vX.Y.Z`. The `desktop-v*` line and `desktop-release.yml` are
   retired. The website `/download` page repoints to `vX.Y.Z` assets.
3. **First unified version:** `0.5.0` (clean leapfrog over ext 0.3.18 / CLI
   0.3.17 / desktop 0.4.0; no tag collisions).
4. **Cargo.toml:** included in the sync (`0.1.0` → unified version, CI-guarded).
5. **Root `patchwire-monorepo` package.json:** included in the sync (every
   version field equal, including the 0.0.0 aggregator root).
6. **Push behavior:** `pnpm release X.Y.Z` **auto-pushes** the tag — one command
   bumps, commits, tags, and pushes, so CI fires immediately. Guarded by
   preflight checks (see below).

## Architecture

### 1. Sync engine — `scripts/release-version.mjs` (pure helpers)

Generalize the existing `scripts/desktop-release-version.mjs` into a repo-wide
module. No I/O in the pure layer (file reader injected) so it stays unit-testable.

**TARGETS** — every version-bearing file:

- `package.json` (root `patchwire-monorepo`)
- `packages/cli/package.json` (`@rebink/patchwire`)
- `packages/core/package.json` (`@patchwire/core`)
- `packages/protocol/package.json` (`@patchwire/protocol`)
- `packages/desktop/package.json` (`patchwire-desktop`)
- `packages/extension/package.json` (`patchwire-vscode`)
- `packages/website/package.json` (`patchwire-docs`)
- `packages/desktop/src-tauri/tauri.conf.json` (JSON)
- `packages/desktop/src-tauri/Cargo.toml` (TOML)

Helpers:

- `isSemver(v)` — unchanged (`^\d+\.\d+\.\d+$`).
- `versionFromTag(ref)` — regex changes from `desktop-v(x.y.z)` to
  `v(x.y.z)`; accepts `vX.Y.Z` or `refs/tags/vX.Y.Z`.
- `bumpJsonVersion(text, version)` — unchanged. Replaces the **first** top-level
  `"version": "…"`. Safe for `package.json` (top-level `version`) and
  `tauri.conf.json` (product `version` on line 4). Dependency maps key on package
  name, so they are never matched.
- `bumpTomlVersion(text, version)` — **new**. Replaces the first
  `^version = "…"` line (the `[package]` crate version in `Cargo.toml`).
- `readAllVersions(readFile)` — returns `{ path, version }[]` across all TARGETS,
  parsing JSON via `JSON.parse` and TOML via the same `^version = "…"` regex.
- `checkVersions(tagRef, versions)` — returns `{ ok, version }` or
  `{ ok: false, reason }`; fails if the tag is not `vX.Y.Z` or if **any** target
  version differs from the tag.

### 2. One command — `pnpm release X.Y.Z`

`scripts/release.mjs` (renamed from `release-desktop.mjs`). Root `package.json`
script `release:desktop` is replaced by `release`.

Bump mode (`pnpm release 0.5.0`):

1. Preflight (abort on any failure):
   - working tree clean,
   - argument is valid semver,
   - current branch is `main`,
   - tag `vX.Y.Z` does not already exist.
2. Bump every TARGET to `X.Y.Z`.
3. `git add` all TARGETS · `git commit -m "chore(release): vX.Y.Z"`.
4. `git tag vX.Y.Z`.
5. `git push origin main` (the release commit) **and** `git push origin vX.Y.Z`.
6. Print the GitHub Actions URL to watch.

`--dry-run` flag: do steps 1–2 in memory and print the diff, but do not write,
commit, tag, or push. (Escape hatch given auto-push.)

Check mode (`pnpm release --check <ref>`): read all TARGETS, run
`checkVersions`, exit non-zero with the mismatch reason on failure. This is the
CI guard.

### 3. One workflow — merge `desktop-release.yml` into `release.yml`

Trigger: `push: tags: ['v*.*.*']`. Two jobs:

- **`desktop`** — the build matrix lifted verbatim from `desktop-release.yml`
  (macOS arm64, Windows x64, Linux x64). Per-runner: `--check` guard, build CLI
  sidecar, stage sidecar, `tauri build` (unsigned), rename bundles to stable
  asset names via `packages/website/src/lib/release-assets.mjs`, upload installers
  as artifacts. The `desktop-v*`-specific `if:` conditions drop (the tag is now
  always `v*`); `workflow_dispatch` dry-run path is preserved.
- **`publish`** (`needs: desktop`, ubuntu) — `--check` guard → `pnpm -r typecheck`
  / `test` / `build` → package `.vsix` → token-gated npm / `vsce` / `ovsx`
  publishes (logic unchanged) → build standalone agent binaries → download the
  desktop artifacts → create **one** GitHub release for `${github.ref_name}` with:
  `.vsix` + agent binaries + installers + `SHASUMS256.txt`.

`SHASUMS256.txt` is generated over the final combined asset set in the `publish`
job (was previously desktop-only).

Delete `.github/workflows/desktop-release.yml`.

### 4. Website repoint

`packages/website/src/lib/release-assets.mjs`:

- `downloadUrl(stable, version)` → `…/releases/download/v${version}/${stable}`.
- `releaseAssetUrl(name, version)` → `…/releases/download/v${version}/${name}`.

`packages/website/src/pages/download.astro` already reads the version from the
desktop `package.json` at build time; since all packages are synced, the value is
correct unchanged. No edit needed beyond what the asset module exposes.

### 5. Tests

- `scripts/release-version.test.mjs` (renamed/expanded from
  `desktop-release-version.test.mjs`): `versionFromTag` for `v*`, JSON + TOML
  bump, `readAllVersions`, `checkVersions` pass + every mismatch shape.
- `packages/website/src/lib/release-assets.test.mjs`: update expected URLs to the
  `v${version}` scheme.

## Migration / rollout

1. Land all tooling on a branch → PR → merge to `main`. No version change in this
   PR (TARGETS still read 0.4.0; the `--check` guard is not exercised until a tag
   is pushed).
2. Cut the first unified release from `main`: `pnpm release 0.5.0`. It bumps all
   TARGETS to 0.5.0, commits, tags `v0.5.0`, and pushes → the merged workflow
   ships CLI + extension + desktop installers + agent binaries at 0.5.0 in one
   GitHub release.
3. Old tags/releases (`desktop-v0.4.0`, `v0.3.0`…`v0.3.18`) are left untouched as
   history.

## Non-goals

- Code signing / notarization of desktop installers (still unsigned, prerelease).
- Independent per-artifact cadence (explicitly rejected — lockstep is the goal).
- Changelog generation / release notes automation.
- Touching the published `desktop-latest` alias decision (already resolved: no
  moving alias; versioned tags only).

## Risks & mitigations

- **Auto-push is irreversible** (publishes to npm/Marketplace the moment CI
  passes). Mitigated by preflight guards (clean tree, on `main`, tag absent) and
  the `--dry-run` flag.
- **npm idempotency:** republishing an already-published version fails the npm
  step. Since 0.5.0 is a clean leapfrog this does not arise on the first release;
  the npm step already tolerates "already published" for Open VSX and should do
  the same for npm (treat "cannot publish over existing version" as skip).
- **`bumpJsonVersion` first-match assumption:** verified safe for all TARGET JSON
  files (top-level `version` precedes any nested map). Covered by tests.
