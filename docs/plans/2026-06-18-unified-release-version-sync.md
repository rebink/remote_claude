# Unified Release Version Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `pnpm release X.Y.Z` command bumps every version field in the repo, tags `vX.Y.Z`, pushes, and a single merged CI workflow publishes CLI + extension + desktop installers at that one version.

**Architecture:** Generalize the existing desktop-only pure version helpers into a repo-wide `release-version.mjs` (9 target files, JSON + TOML). A new `release.mjs` does bump/commit/tag/auto-push plus a `--check` CI guard. The two release workflows (`release.yml` + `desktop-release.yml`) merge into one `v*`-triggered workflow producing one GitHub release. The website download URLs repoint from `desktop-v*` to `v*`.

**Tech Stack:** Node ESM scripts, `node:test`, GitHub Actions, pnpm workspaces, Tauri, Astro.

Spec: `docs/specs/2026-06-18-unified-release-version-sync-design.md`.

---

### Task 1: Repo-wide version helpers (`release-version.mjs`)

**Files:**
- Create: `scripts/release-version.mjs`
- Test: `scripts/release-version.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/release-version.test.mjs`:

```js
// scripts/release-version.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TARGETS, isSemver, versionFromTag,
  bumpJsonVersion, bumpTomlVersion, bumpVersion,
  readVersion, readAllVersions, checkVersions,
} from "./release-version.mjs";

test("TARGETS covers all 9 version-bearing files", () => {
  assert.equal(TARGETS.length, 9);
  assert.ok(TARGETS.includes("package.json"));
  assert.ok(TARGETS.includes("packages/cli/package.json"));
  assert.ok(TARGETS.includes("packages/desktop/src-tauri/tauri.conf.json"));
  assert.ok(TARGETS.includes("packages/desktop/src-tauri/Cargo.toml"));
});

test("isSemver", () => {
  assert.ok(isSemver("0.5.0"));
  assert.ok(!isSemver("0.5"));
  assert.ok(!isSemver("v0.5.0"));
  assert.ok(!isSemver("0.5.0-beta"));
});

test("versionFromTag accepts v* (not desktop-v*)", () => {
  assert.equal(versionFromTag("v0.5.0"), "0.5.0");
  assert.equal(versionFromTag("refs/tags/v1.2.3"), "1.2.3");
  assert.equal(versionFromTag("desktop-v0.5.0"), null);
  assert.equal(versionFromTag("vX"), null);
});

test("bumpJsonVersion replaces only the top-level version", () => {
  const pkg = `{\n  "name": "x",\n  "version": "0.4.0",\n  "dependencies": { "@tauri-apps/api": "^2" }\n}\n`;
  const out = bumpJsonVersion(pkg, "0.5.0");
  assert.match(out, /"version": "0\.5\.0"/);
  assert.match(out, /"@tauri-apps\/api": "\^2"/);
});

test("bumpJsonVersion throws when no version key", () => {
  assert.throws(() => bumpJsonVersion(`{ "name": "x" }`, "0.5.0"), /version/);
});

test("bumpTomlVersion replaces only the [package] crate version, not deps", () => {
  const toml = `[package]\nname = "desktop"\nversion = "0.1.0"\n\n[dependencies]\ntauri = { version = "2" }\n`;
  const out = bumpTomlVersion(toml, "0.5.0");
  assert.match(out, /^version = "0\.5\.0"$/m);
  assert.match(out, /tauri = \{ version = "2" \}/);
});

test("bumpVersion dispatches on extension", () => {
  assert.match(bumpVersion("a/Cargo.toml", `version = "0.1.0"\n`, "0.5.0"), /version = "0\.5\.0"/);
  assert.match(bumpVersion("a/package.json", `{"version":"0.1.0"}`, "0.5.0"), /"version":"0\.5\.0"/);
});

test("readVersion reads JSON and TOML", () => {
  assert.equal(readVersion("a/package.json", `{"version":"0.4.0"}`), "0.4.0");
  assert.equal(readVersion("a/Cargo.toml", `[package]\nversion = "0.1.0"\n`), "0.1.0");
});

test("readAllVersions uses the injected reader for every target", () => {
  const fake = (p) => (p.endsWith(".toml") ? `version = "0.4.0"\n` : `{"version":"0.4.0"}`);
  const all = readAllVersions(fake);
  assert.equal(all.length, 9);
  assert.ok(all.every((t) => t.version === "0.4.0"));
});

test("checkVersions ok / mismatch / bad tag", () => {
  const all = [{ path: "a", version: "0.5.0" }, { path: "b", version: "0.5.0" }];
  assert.deepEqual(checkVersions("v0.5.0", all), { ok: true, version: "0.5.0" });

  const drift = [{ path: "a", version: "0.5.0" }, { path: "Cargo.toml", version: "0.1.0" }];
  const bad = checkVersions("v0.5.0", drift);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /Cargo\.toml=0\.1\.0/);

  assert.equal(checkVersions("desktop-v0.5.0", all).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/release-version.test.mjs`
Expected: FAIL — `Cannot find module './release-version.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/release-version.mjs`:

```js
// scripts/release-version.mjs
// Pure helpers for keeping EVERY package version in sync with the v<x.y.z>
// release tag. No I/O — the file reader is injected so this stays unit-testable.

export const JSON_TARGETS = [
  "package.json",
  "packages/cli/package.json",
  "packages/core/package.json",
  "packages/protocol/package.json",
  "packages/desktop/package.json",
  "packages/extension/package.json",
  "packages/website/package.json",
  "packages/desktop/src-tauri/tauri.conf.json",
];

export const TOML_TARGETS = ["packages/desktop/src-tauri/Cargo.toml"];

export const TARGETS = [...JSON_TARGETS, ...TOML_TARGETS];

export function isSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(String(v));
}

/** `v0.5.0` or `refs/tags/v0.5.0` -> "0.5.0"; else null. */
export function versionFromTag(ref) {
  const m = String(ref).match(/(?:^|\/)v(\d+\.\d+\.\d+)$/);
  return m ? m[1] : null;
}

/** Replace the FIRST top-level `"version": "..."`, preserving all other text. */
export function bumpJsonVersion(jsonText, version) {
  const re = /("version"\s*:\s*")[^"]*(")/;
  if (!re.test(jsonText)) throw new Error('no "version" key found');
  return jsonText.replace(re, `$1${version}$2`);
}

/** Replace the FIRST line-anchored `version = "..."` (the [package] crate version). */
export function bumpTomlVersion(tomlText, version) {
  const re = /^(version\s*=\s*")[^"]*(")/m;
  if (!re.test(tomlText)) throw new Error("no version key found");
  return tomlText.replace(re, `$1${version}$2`);
}

/** Bump any target's text, choosing JSON vs TOML by file extension. */
export function bumpVersion(path, text, version) {
  return path.endsWith(".toml") ? bumpTomlVersion(text, version) : bumpJsonVersion(text, version);
}

/** Read the version out of any target file's text. */
export function readVersion(path, text) {
  if (path.endsWith(".toml")) {
    const m = text.match(/^version\s*=\s*"([^"]*)"/m);
    if (!m) throw new Error(`no version in ${path}`);
    return m[1];
  }
  return JSON.parse(text).version;
}

/** Read { path, version } for every TARGET via an injected reader (path)=>text. */
export function readAllVersions(readFile) {
  return TARGETS.map((path) => ({ path, version: readVersion(path, readFile(path)) }));
}

/** Compare a tag ref against every target version. */
export function checkVersions(tagRef, versions) {
  const v = versionFromTag(tagRef);
  if (!v) return { ok: false, reason: `not a v* tag: ${tagRef}` };
  const bad = versions.filter((t) => t.version !== v);
  if (bad.length) {
    const detail = bad.map((t) => `${t.path}=${t.version}`).join(", ");
    return { ok: false, reason: `version mismatch — tag ${v}, but ${detail}` };
  }
  return { ok: true, version: v };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/release-version.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/release-version.mjs scripts/release-version.test.mjs
git commit -m "feat(release): repo-wide version helpers (JSON + TOML, v* tag)"
```

---

### Task 2: `pnpm release` command + retire desktop-only scripts

**Files:**
- Create: `scripts/release.mjs`
- Modify: `package.json` (root, scripts)
- Delete: `scripts/release-desktop.mjs`, `scripts/desktop-release-version.mjs`, `scripts/desktop-release-version.test.mjs`

- [ ] **Step 1: Write the release command**

Create `scripts/release.mjs`:

```js
// scripts/release.mjs
// One-command unified release.
//   node scripts/release.mjs <X.Y.Z>            bump ALL targets, commit, tag, push (CI fires)
//   node scripts/release.mjs --dry-run <X.Y.Z>  print the planned bumps, write/commit/push nothing
//   node scripts/release.mjs --check <ref>       assert tag == every target version (CI guard)
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { TARGETS, isSemver, bumpVersion, readVersion, readAllVersions, checkVersions } from "./release-version.mjs";

const read = (p) => readFileSync(p, "utf8");
const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const args = process.argv.slice(2);

// --check <ref> — CI guard
if (args[0] === "--check") {
  const ref = args[1];
  if (!ref) die("usage: release.mjs --check <ref>");
  const r = checkVersions(ref, readAllVersions(read));
  if (!r.ok) die(r.reason);
  console.log(`✓ ${ref} matches all ${TARGETS.length} targets at ${r.version}`);
  process.exit(0);
}

// --dry-run <X.Y.Z>
const dryRun = args[0] === "--dry-run";
const version = dryRun ? args[1] : args[0];
if (!version || !isSemver(version)) die(`expected a semver version, e.g. 0.5.0 (got: ${version ?? "<none>"})`);
const tag = `v${version}`;

if (dryRun) {
  for (const path of TARGETS) {
    console.log(`${path}: ${readVersion(path, read(path))} -> ${version}`);
  }
  console.log(`(dry run) would commit, tag ${tag}, push origin main + ${tag}`);
  process.exit(0);
}

// Live release — preflight guards (auto-push is irreversible)
if (sh("git status --porcelain")) die("working tree is dirty — commit or stash first");
const branch = sh("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") die(`releases must be cut from main (on ${branch})`);
try { sh(`git rev-parse -q --verify refs/tags/${tag}`); die(`tag ${tag} already exists`); } catch { /* good: tag missing */ }

for (const path of TARGETS) {
  writeFileSync(path, bumpVersion(path, read(path), version));
}
sh(`git add ${TARGETS.join(" ")}`);
sh(`git commit -m "chore(release): ${tag}"`);
sh(`git tag ${tag}`);
sh("git push origin main");
sh(`git push origin ${tag}`);

console.log(`✓ released ${tag}: bumped ${TARGETS.length} files, committed, tagged, pushed`);
console.log("→ watch CI: https://github.com/rebink/remote_claude/actions");
```

- [ ] **Step 2: Point the root script at the new command**

In `package.json` (root), replace the `release:desktop` script line:

```json
    "release:desktop": "node scripts/release-desktop.mjs"
```

with:

```json
    "release": "node scripts/release.mjs"
```

- [ ] **Step 3: Delete the desktop-only scripts**

```bash
git rm scripts/release-desktop.mjs scripts/desktop-release-version.mjs scripts/desktop-release-version.test.mjs
```

- [ ] **Step 4: Verify the guard fires on current drift, dry-run lists all bumps**

The repo is intentionally NOT yet in sync (root `package.json` is `0.0.0`, `Cargo.toml` is `0.1.0`), so `--check v0.4.0` MUST fail — proving the guard works.

Run: `node scripts/release.mjs --check v0.4.0`
Expected: exit 1, message containing `package.json=0.0.0` and `Cargo.toml=0.1.0`.

Run: `node scripts/release.mjs --dry-run 0.5.0`
Expected: 9 lines `…: <current> -> 0.5.0` then `(dry run) would commit, tag v0.5.0, push origin main + v0.5.0`. No files changed (`git status --porcelain` is empty afterward).

- [ ] **Step 5: Commit**

```bash
git add scripts/release.mjs package.json
git commit -m "feat(release): pnpm release CLI (bump all + auto-push) — retire desktop-only scripts"
```

---

### Task 3: Repoint website download URLs to `v*`

**Files:**
- Modify: `packages/website/src/lib/release-assets.mjs:30-37`
- Test: `packages/website/src/lib/release-assets.test.mjs:24-29`

- [ ] **Step 1: Update the failing test**

In `packages/website/src/lib/release-assets.test.mjs`, replace the `downloadUrl` test (lines 24–29) with:

```js
test("downloadUrl points at the versioned v* release tag", () => {
  assert.equal(
    downloadUrl("Patchwire-macos-arm64.dmg", "0.4.0"),
    "https://github.com/rebink/remote_claude/releases/download/v0.4.0/Patchwire-macos-arm64.dmg",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/website/src/lib/release-assets.test.mjs`
Expected: FAIL — actual URL still contains `desktop-v0.4.0`.

- [ ] **Step 3: Update the asset module**

In `packages/website/src/lib/release-assets.mjs`, replace the two URL builders (the `downloadUrl` and `releaseAssetUrl` exports) and their doc comment with:

```js
/**
 * Download URL for a stable asset under the unified versioned release `v<version>`.
 * `version` is the desktop package version (read at build time on the website), which
 * MUST match the pushed release tag (`v<version>`) — every package shares one version,
 * enforced by `scripts/release.mjs --check` in CI. The site rebuilds on each bump, so
 * the URLs stay current.
 */
export const downloadUrl = (stable, version) =>
  `https://github.com/${repo}/releases/download/v${version}/${stable}`;

/** Versioned release URL for an arbitrary asset (e.g. SHASUMS256.txt). */
export const releaseAssetUrl = (name, version) =>
  `https://github.com/${repo}/releases/download/v${version}/${name}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/website/src/lib/release-assets.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/website/src/lib/release-assets.mjs packages/website/src/lib/release-assets.test.mjs
git commit -m "fix(website): point /download at unified v* release tag"
```

---

### Task 4: Merge the two release workflows into one

**Files:**
- Modify: `.github/workflows/release.yml` (full rewrite)
- Delete: `.github/workflows/desktop-release.yml`

- [ ] **Step 1: Rewrite `release.yml`**

Replace the entire contents of `.github/workflows/release.yml` with:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:

permissions:
  contents: write
  id-token: write

jobs:
  desktop:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            triple: aarch64-apple-darwin
            bunTarget: bun-darwin-arm64
            assetOs: macos
          - os: ubuntu-22.04
            triple: x86_64-unknown-linux-gnu
            bunTarget: bun-linux-x64
            assetOs: linux
          - os: windows-latest
            triple: x86_64-pc-windows-msvc
            bunTarget: bun-windows-x64
            assetOs: windows
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Verify tag matches every package version
        if: startsWith(github.ref, 'refs/tags/v')
        env:
          REF_NAME: ${{ github.ref_name }}
        run: node scripts/release.mjs --check "$REF_NAME"

      - name: Install Linux WebKitGTK deps
        if: matrix.os == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - uses: oven-sh/setup-bun@v2
      - uses: dtolnay/rust-toolchain@stable

      - name: Install workspace deps
        run: pnpm install --frozen-lockfile

      - name: Build the CLI sidecar binary for this runner
        run: node scripts/build-cli-binaries.mjs --only ${{ matrix.bunTarget }}

      - name: Stage the sidecar for this platform
        run: node packages/desktop/scripts/stage-sidecar.mjs --from-release dist-cli-bin

      - name: Build the desktop app (unsigned)
        run: pnpm --filter patchwire-desktop tauri build

      - name: Rename bundles to stable asset names (shared constant)
        shell: bash
        run: |
          mkdir -p out
          node -e '
            (async () => {
              const { releaseAssets } = await import("./packages/website/src/lib/release-assets.mjs");
              const fs = require("fs");
              const cp = require("child_process");
              const bundleDir = "packages/desktop/src-tauri/target/release/bundle";
              const findByExt = (ext) =>
                cp.execSync(`find ${bundleDir} -type f -name "*.${ext}"`).toString().trim().split("\n").filter(Boolean);
              const extFor = { dmg: "dmg", nsis: "exe", deb: "deb", rpm: "rpm" };
              for (const a of releaseAssets.filter((a) => a.os === process.env.ASSET_OS)) {
                const matches = findByExt(extFor[a.kind]);
                if (!matches.length) { console.log(`no ${a.kind} bundle found, skipping ${a.stable}`); continue; }
                fs.copyFileSync(matches[0], `out/${a.stable}`);
                console.log(`out/${a.stable} <- ${matches[0]}`);
              }
            })().catch((e) => { console.error(e); process.exit(1); });
          '
        env:
          ASSET_OS: ${{ matrix.assetOs }}

      - uses: actions/upload-artifact@v4
        with:
          name: patchwire-desktop-${{ matrix.assetOs }}
          path: out/**
          if-no-files-found: warn

  publish:
    needs: desktop
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - name: Verify tag matches every package version
        env:
          REF_NAME: ${{ github.ref_name }}
        run: node scripts/release.mjs --check "$REF_NAME"

      - run: pnpm install --frozen-lockfile=false

      - name: Configure git for tests
        run: |
          git config --global user.email "ci@example.com"
          git config --global user.name "CI"
          git config --global init.defaultBranch main

      - run: pnpm -r typecheck
      - run: pnpm -r test
      - run: pnpm -r build

      - name: Package VS Code extension (.vsix)
        run: pnpm --filter patchwire-vscode package

      # Each publish step runs only when its token/secret is configured, so a
      # tag push always produces the GitHub release + assets even before the
      # npm / Marketplace / Open VSX accounts are set up.
      - name: Check which publish secrets are configured
        id: secrets
        run: |
          echo "npm=${{ secrets.NPM_TOKEN != '' }}" >> "$GITHUB_OUTPUT"
          echo "vsce=${{ secrets.VSCE_PAT != '' }}" >> "$GITHUB_OUTPUT"
          echo "ovsx=${{ secrets.OVSX_TOKEN != '' }}" >> "$GITHUB_OUTPUT"

      - name: Publish CLI to npm
        if: steps.secrets.outputs.npm == 'true'
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          VER=$(node -p "require('./packages/cli/package.json').version")
          if npm view "@rebink/patchwire@$VER" version >/dev/null 2>&1; then
            echo "@rebink/patchwire@$VER already on npm — skipping (idempotent re-run)."
          else
            pnpm --filter @rebink/patchwire publish --access public --provenance --no-git-checks
          fi

      - name: Publish extension to the VS Code Marketplace
        if: steps.secrets.outputs.vsce == 'true'
        working-directory: packages/extension
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
        run: |
          out=$(pnpm exec vsce publish --no-dependencies --packagePath *.vsix 2>&1) || {
            echo "$out"
            echo "$out" | grep -qi "already exists" && { echo "version already on the Marketplace — skipping (idempotent)."; exit 0; }
            exit 1
          }
          echo "$out"

      - name: Publish extension to Open VSX
        if: steps.secrets.outputs.ovsx == 'true'
        working-directory: packages/extension
        env:
          OVSX_PAT: ${{ secrets.OVSX_TOKEN }}
        run: |
          out=$(pnpm exec ovsx publish *.vsix 2>&1) || {
            echo "$out"
            echo "$out" | grep -qi "already exists\|already published" && { echo "version already on Open VSX — skipping (idempotent)."; exit 0; }
            exit 1
          }
          echo "$out"

      - uses: oven-sh/setup-bun@v2

      - name: Build standalone agent binaries (bun --compile)
        run: node scripts/build-agent-binaries.mjs

      - name: Smoke-test the linux-x64 agent binary
        run: ./dist-bin/patchwire-agent-linux-x64 --version

      - name: Download desktop installers
        uses: actions/download-artifact@v4
        with:
          path: desktop-artifacts

      - name: Flatten installers + checksum
        shell: bash
        run: |
          mkdir -p release
          find desktop-artifacts -type f -exec cp {} release/ \;
          cd release && sha256sum * > SHASUMS256.txt && cat SHASUMS256.txt

      - name: Create one GitHub release (extension + agent + desktop)
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: ${{ github.ref_name }}
          prerelease: true
          generate_release_notes: true
          files: |
            packages/extension/patchwire-vscode-*.vsix
            dist-bin/patchwire-agent-*
            dist-bin/manifest.json
            release/*
```

- [ ] **Step 2: Delete the old desktop workflow**

```bash
git rm .github/workflows/desktop-release.yml
```

- [ ] **Step 3: Validate the workflow YAML**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8'); require('child_process').execSync('npx --yes js-yaml .github/workflows/release.yml',{stdio:'inherit'})"`
Expected: prints the parsed YAML with no parse error. (If `js-yaml` is unavailable offline, instead confirm the file has exactly two top-level jobs — `desktop` and `publish` — and `publish` has `needs: desktop`.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): merge desktop build into the v* workflow — one tag, one release"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test + typecheck suite**

Run: `pnpm -r test && pnpm -r typecheck && node --test scripts/release-version.test.mjs`
Expected: all green. No references remain to the deleted scripts.

- [ ] **Step 2: Confirm nothing still references retired names**

Run: `grep -rn "release-desktop\|desktop-release-version\|desktop-v" --include=*.mjs --include=*.js --include=*.ts --include=*.astro --include=*.yml . | grep -v node_modules | grep -v docs/`
Expected: no output (the spec/plan docs under `docs/` may still mention them as history — that's fine).

- [ ] **Step 3: Commit any incidental cleanup**

```bash
git add -A && git commit -m "chore(release): finalize unified version-sync cleanup" || echo "nothing to commit"
```

---

## First release (manual, after merge to main)

Not part of the automated plan — run by a human once the branch is merged:

```bash
git checkout main && git pull
pnpm release 0.5.0
```

This bumps all 9 targets to 0.5.0, commits `chore(release): v0.5.0`, tags `v0.5.0`, pushes main + tag, and CI ships CLI + extension + desktop installers + agent binaries at 0.5.0 in one GitHub release.

---

## Self-Review

**Spec coverage:**
- Sync engine (9 TARGETS, JSON+TOML, v* regex, checkVersions) → Task 1 ✓
- `pnpm release` (bump/commit/tag/auto-push, --dry-run, --check) → Task 2 ✓
- Merge workflows + delete desktop-release.yml → Task 4 ✓
- Website repoint → Task 3 ✓
- Root pkg + Cargo.toml included → TARGETS in Task 1 ✓
- Auto-push w/ preflight guards → Task 2 release.mjs ✓
- First release 0.5.0 → manual section ✓

**Placeholder scan:** none — every code/YAML block is complete.

**Type consistency:** `checkVersions(tagRef, versions[])` (array of `{path,version}`) used consistently in Task 1 tests, `release.mjs`, and verified via `readAllVersions`. `bumpVersion(path,text,version)` / `readVersion(path,text)` signatures match across script and tests.
