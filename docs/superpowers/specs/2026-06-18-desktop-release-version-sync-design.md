# Desktop release version↔tag sync (one-command script + CI guard)

**Date:** 2026-06-18
**Status:** Approved design, ready for plan
**Relates to:** `.github/workflows/desktop-release.yml`, `packages/website/src/lib/release-assets.mjs` (`downloadUrl` reads the desktop version at site build time → the version MUST equal the pushed `desktop-v<version>` tag), memory `website-desktop-downloads`.

---

## Problem

The website builds download URLs as `releases/download/desktop-v${version}/…` where `version` is read at build time from `packages/desktop/package.json`. A release is cut by pushing a `desktop-v<X.Y.Z>` tag. If the developer pushes a tag whose version doesn't match `package.json` (forgot to bump, or typo), the published release tag and the site's URLs diverge → broken downloads. This is easy to forget. Automate the coupling so one command keeps them in sync, and CI refuses to publish a mismatch.

## Decision (from brainstorm)

**One-command release script + CI guard.** Lowest infra: no CI write-back, no GitHub-API/deploy-hook machinery.

## Architecture

### Shared pure helpers (`scripts/desktop-release-version.mjs`)

Pure, no I/O, unit-tested with `node --test`:
- `isSemver(v: string): boolean` — matches `^\d+\.\d+\.\d+$` (no pre-release suffix in v1).
- `versionFromTag(ref: string): string | null` — `desktop-v0.5.0` → `0.5.0`; returns null if not a `desktop-v*` tag (accepts a bare ref or `refs/tags/desktop-v0.5.0`).
- `bumpJsonVersion(jsonText: string, version: string): string` — replace the top-level `"version": "…"` value, preserving the rest of the file's formatting (regex on the `"version"` line, not a JSON re-serialize, so 2-space/4-space/key-order stay intact). Throws if no `"version"` key found.
- `readDesktopVersions(readFile)` — given a file reader, return `{ pkg, conf }` versions from `packages/desktop/package.json` + `packages/desktop/src-tauri/tauri.conf.json`. (Reader injected so it's testable.)

### CLI (`scripts/release-desktop.mjs`)

Node, zero deps, imports the helpers. Two modes:

**Bump mode** — `node scripts/release-desktop.mjs <X.Y.Z>`:
1. Validate `<X.Y.Z>` is semver; error + exit 1 otherwise.
2. Guard: refuse if `git status --porcelain` is non-empty (dirty tree) or the tag `desktop-v<X.Y.Z>` already exists locally (`git rev-parse`); clear message + exit 1.
3. Rewrite `version` in `packages/desktop/package.json` and `packages/desktop/src-tauri/tauri.conf.json` via `bumpJsonVersion`.
4. `git add` both files; `git commit -m "chore(desktop): release v<X.Y.Z>"`.
5. `git tag desktop-v<X.Y.Z>`.
6. **Print** the next step (does NOT push):
   ```
   ✓ bumped to 0.5.0, committed, tagged desktop-v0.5.0
   → push the tag to release:  git push origin desktop-v0.5.0
   ```

**Check mode** — `node scripts/release-desktop.mjs --check <ref>`:
- `v = versionFromTag(ref)`; if null → error "not a desktop-v* tag".
- Read pkg + conf versions; if `v !== pkg || v !== conf` → print the three values + exit 1.
- Match → print "ok" + exit 0.

**Root script alias** in `package.json`: `"release:desktop": "node scripts/release-desktop.mjs"` → `pnpm release:desktop 0.5.0`.

### CI guard (`.github/workflows/desktop-release.yml`)

Add an early step in the `build` job (right after `actions/checkout`, before the heavy build), gated to tag pushes so dry-runs skip it:
```yaml
- name: Verify tag matches desktop version
  if: startsWith(github.ref, 'refs/tags/desktop-v')
  run: node scripts/release-desktop.mjs --check "${{ github.ref_name }}"
```
Fails fast (seconds) before the ~10-min Tauri build if the tag and `package.json`/`tauri.conf.json` disagree. `github.ref_name` is a trusted tag name (no untrusted event input).

## Data flow

```
pnpm release:desktop 0.5.0
  → bump package.json + tauri.conf to 0.5.0, commit, tag desktop-v0.5.0, print push cmd
developer: git push origin desktop-v0.5.0
  → CI build job: "Verify tag matches desktop version" (0.5.0 == pkg == conf) → pass → build + publish
  → site (after deploy) reads package.json 0.5.0 → downloadUrl → desktop-v0.5.0 assets ✓
```

## Testing

- **`scripts/desktop-release-version.test.mjs`** (`node --test`): `isSemver` (valid/invalid); `versionFromTag` (`desktop-v0.5.0`, `refs/tags/desktop-v1.2.3`, non-matching → null); `bumpJsonVersion` (replaces only the top-level version, preserves surrounding text, throws when absent); `readDesktopVersions` with a fake reader.
- **CLI**: the pure logic is covered by the helpers' tests; the git/file I/O of bump mode + the CI step are **live-verify** (run `pnpm release:desktop` on a throwaway, and the real release run). A focused test can still cover check-mode's comparison by invoking the exported `checkVersions(tagRef, pkg, conf)` helper.
- Run all new tests: `node --test scripts/desktop-release-version.test.mjs`.

## Out of scope

- Auto-pushing the tag (developer pushes — respects the main-push guard).
- Pre-release / build-metadata semver suffixes.
- Changelog generation; bumping `Cargo.toml` (the Tauri bundle version comes from `tauri.conf.json`, which is authoritative).
- Website redeploy trigger after a release (the API-driven option was not chosen).

## Build sequence (for the plan)

1. `scripts/desktop-release-version.mjs` (pure helpers: `isSemver`, `versionFromTag`, `bumpJsonVersion`, `readDesktopVersions`, `checkVersions`) + `scripts/desktop-release-version.test.mjs`.
2. `scripts/release-desktop.mjs` (CLI: bump mode + `--check` mode, using the helpers + git/fs).
3. `package.json` root: add `"release:desktop"` script.
4. `.github/workflows/desktop-release.yml`: add the gated "Verify tag matches desktop version" step in the build job.
