# Desktop Release Version Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-command release helper (`pnpm release:desktop X.Y.Z`) that keeps `packages/desktop/package.json`, `src-tauri/tauri.conf.json`, and the `desktop-vX.Y.Z` git tag in sync, plus a CI guard that fails the release build if a pushed tag doesn't match those versions.

**Architecture:** Pure, unit-tested helpers (`scripts/desktop-release-version.mjs`) do version parsing/bumping/checking. A thin CLI (`scripts/release-desktop.mjs`) wraps them with git/fs for bump-mode and `--check` mode. The release workflow runs `--check` as an early, tag-gated step.

**Tech Stack:** Node (zero deps), `node --test`, GitHub Actions. Spec: `docs/superpowers/specs/2026-06-18-desktop-release-version-sync-design.md`.

---

## File Structure

- Create: `scripts/desktop-release-version.mjs` — pure helpers (`isSemver`, `versionFromTag`, `bumpJsonVersion`, `readDesktopVersions`, `checkVersions`).
- Create: `scripts/desktop-release-version.test.mjs` — `node --test`.
- Create: `scripts/release-desktop.mjs` — CLI (bump + `--check`).
- Modify: `package.json` (root) — add `"release:desktop"` script.
- Modify: `.github/workflows/desktop-release.yml` — add the tag-gated verify step.

**Test command:** `node --test scripts/desktop-release-version.test.mjs`.

---

## Task 1: Pure version helpers + tests

**Files:**
- Create: `scripts/desktop-release-version.mjs`
- Create: `scripts/desktop-release-version.test.mjs`

- [ ] **Step 1: Write the test**

```js
// scripts/desktop-release-version.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSemver, versionFromTag, bumpJsonVersion, readDesktopVersions, checkVersions } from "./desktop-release-version.mjs";

test("isSemver", () => {
  assert.ok(isSemver("0.5.0"));
  assert.ok(isSemver("12.0.34"));
  assert.ok(!isSemver("0.5"));
  assert.ok(!isSemver("v0.5.0"));
  assert.ok(!isSemver("0.5.0-beta"));
});

test("versionFromTag", () => {
  assert.equal(versionFromTag("desktop-v0.5.0"), "0.5.0");
  assert.equal(versionFromTag("refs/tags/desktop-v1.2.3"), "1.2.3");
  assert.equal(versionFromTag("v0.5.0"), null);
  assert.equal(versionFromTag("desktop-vX"), null);
});

test("bumpJsonVersion replaces only the top-level version, preserves formatting", () => {
  const pkg = `{\n  "name": "patchwire-desktop",\n  "version": "0.4.0",\n  "dependencies": { "@tauri-apps/api": "^2" }\n}\n`;
  const out = bumpJsonVersion(pkg, "0.5.0");
  assert.match(out, /"version": "0\.5\.0"/);
  assert.match(out, /"@tauri-apps\/api": "\^2"/); // dep version untouched
  assert.ok(out.includes('"name": "patchwire-desktop"'));
});

test("bumpJsonVersion throws when no version key", () => {
  assert.throws(() => bumpJsonVersion(`{ "name": "x" }`, "0.5.0"), /version/);
});

test("readDesktopVersions uses the injected reader", () => {
  const fake = (p) =>
    p.endsWith("package.json") ? `{"version":"0.4.0"}` : `{"version":"0.4.0"}`;
  assert.deepEqual(readDesktopVersions(fake), { pkg: "0.4.0", conf: "0.4.0" });
});

test("checkVersions ok / mismatch / bad tag", () => {
  assert.deepEqual(checkVersions("desktop-v0.5.0", "0.5.0", "0.5.0"), { ok: true, version: "0.5.0" });
  assert.equal(checkVersions("desktop-v0.5.0", "0.4.0", "0.5.0").ok, false);
  assert.equal(checkVersions("not-a-tag", "0.5.0", "0.5.0").ok, false);
});
```

- [ ] **Step 2: Run → FAIL**

Run: `cd /Users/apple/Documents/Workspace/patchwire && node --test scripts/desktop-release-version.test.mjs`
Expected: FAIL — cannot find module `./desktop-release-version.mjs`.

- [ ] **Step 3: Implement**

```js
// scripts/desktop-release-version.mjs
// Pure helpers for keeping the desktop version in sync with the desktop-v<x.y.z>
// release tag. No I/O — the file reader is injected so this is unit-testable.

export const PKG_PATH = "packages/desktop/package.json";
export const CONF_PATH = "packages/desktop/src-tauri/tauri.conf.json";

export function isSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(String(v));
}

/** `desktop-v0.5.0` or `refs/tags/desktop-v0.5.0` -> "0.5.0"; else null. */
export function versionFromTag(ref) {
  const m = String(ref).match(/(?:^|\/)desktop-v(\d+\.\d+\.\d+)$/);
  return m ? m[1] : null;
}

/** Replace the FIRST top-level `"version": "..."` value, preserving all other text. */
export function bumpJsonVersion(jsonText, version) {
  const re = /("version"\s*:\s*")[^"]*(")/;
  if (!re.test(jsonText)) throw new Error('no "version" key found');
  return jsonText.replace(re, `$1${version}$2`);
}

/** Read pkg + tauri.conf versions using an injected reader `(path) => text`. */
export function readDesktopVersions(readFile) {
  const pkg = JSON.parse(readFile(PKG_PATH)).version;
  const conf = JSON.parse(readFile(CONF_PATH)).version;
  return { pkg, conf };
}

/** Compare a tag ref against pkg + conf versions. */
export function checkVersions(tagRef, pkg, conf) {
  const v = versionFromTag(tagRef);
  if (!v) return { ok: false, reason: `not a desktop-v* tag: ${tagRef}` };
  if (v !== pkg || v !== conf) {
    return { ok: false, reason: `version mismatch — tag ${v}, package.json ${pkg}, tauri.conf ${conf}` };
  }
  return { ok: true, version: v };
}
```

- [ ] **Step 4: Run → PASS** (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/desktop-release-version.mjs scripts/desktop-release-version.test.mjs
git commit -m "feat(release): pure helpers for desktop version<->tag sync"
```

---

## Task 2: `release-desktop.mjs` CLI (bump + --check) + root script

**Files:**
- Create: `scripts/release-desktop.mjs`
- Modify: `package.json` (root)

The CLI's git/fs side is live-verify; its decision logic comes from Task 1's tested helpers.

- [ ] **Step 1: Implement `scripts/release-desktop.mjs`**

```js
// scripts/release-desktop.mjs
// One-command desktop release helper.
//   node scripts/release-desktop.mjs <X.Y.Z>        bump pkg+conf, commit, tag, print push cmd
//   node scripts/release-desktop.mjs --check <ref>  assert tag version == pkg == conf (CI guard)
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  PKG_PATH, CONF_PATH, isSemver, versionFromTag, bumpJsonVersion,
  readDesktopVersions, checkVersions,
} from "./desktop-release-version.mjs";

const read = (p) => readFileSync(p, "utf8");
const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const args = process.argv.slice(2);

if (args[0] === "--check") {
  const ref = args[1];
  if (!ref) die("usage: release-desktop.mjs --check <ref>");
  const { pkg, conf } = readDesktopVersions(read);
  const r = checkVersions(ref, pkg, conf);
  if (!r.ok) die(r.reason);
  console.log(`✓ ${ref} matches desktop version ${r.version}`);
  process.exit(0);
}

// Bump mode
const version = args[0];
if (!version || !isSemver(version)) die(`expected a semver version, e.g. 0.5.0 (got: ${version ?? "<none>"})`);
const tag = `desktop-v${version}`;

if (sh("git status --porcelain")) die("working tree is dirty — commit or stash first");
try { sh(`git rev-parse -q --verify refs/tags/${tag}`); die(`tag ${tag} already exists`); } catch { /* good: tag missing */ }

for (const path of [PKG_PATH, CONF_PATH]) {
  writeFileSync(path, bumpJsonVersion(read(path), version));
}
sh(`git add ${PKG_PATH} ${CONF_PATH}`);
sh(`git commit -m "chore(desktop): release v${version}"`);
sh(`git tag ${tag}`);

console.log(`✓ bumped to ${version}, committed, tagged ${tag}`);
console.log(`→ push the tag to release:  git push origin ${tag}`);
```

NOTE on the `git rev-parse` tag check: `git rev-parse -q --verify refs/tags/<tag>` exits non-zero (throws) when the tag is MISSING. So the `try { ...; die("already exists") } catch {}` is correct: success path means the tag exists → die; throw means missing → proceed.

- [ ] **Step 2: Add the root script**

In the root `package.json` `"scripts"`, add (keep the others):
```json
    "release:desktop": "node scripts/release-desktop.mjs"
```

- [ ] **Step 3: Smoke-test `--check` against the current repo (must pass — pkg+conf are both 0.4.0)**

Run: `cd /Users/apple/Documents/Workspace/patchwire && node scripts/release-desktop.mjs --check desktop-v0.4.0; echo "exit=$?"`
Expected: `✓ desktop-v0.4.0 matches desktop version 0.4.0` and `exit=0`.

Run the mismatch case: `node scripts/release-desktop.mjs --check desktop-v9.9.9; echo "exit=$?"`
Expected: prints `✗ version mismatch — tag 9.9.9, package.json 0.4.0, tauri.conf 0.4.0` and `exit=1`.

(Do NOT run bump mode here — it would create a real commit + tag. Bump mode is live-verified by the user when cutting a release.)

- [ ] **Step 4: Commit**

```bash
git add scripts/release-desktop.mjs package.json
git commit -m "feat(release): pnpm release:desktop CLI (bump + --check)"
```

---

## Task 3: CI guard in the release workflow

**Files:**
- Modify: `.github/workflows/desktop-release.yml`

- [ ] **Step 1: Add the verify step to the `build` job**

Read `.github/workflows/desktop-release.yml`. In the `build` job's `steps:`, immediately AFTER the `- uses: actions/checkout@v4` step and BEFORE the WebKitGTK/deps steps, insert:

```yaml
      - name: Verify tag matches desktop version
        if: startsWith(github.ref, 'refs/tags/desktop-v')
        run: node scripts/release-desktop.mjs --check "${{ github.ref_name }}"
```

This runs only on `desktop-v*` tag pushes (workflow_dispatch dry-runs skip it), fails fast before the ~10-min build if the tag and `package.json`/`tauri.conf.json` disagree. `github.ref_name` is a trusted tag name.

- [ ] **Step 2: Validate the YAML**

Run: `cd /Users/apple/Documents/Workspace/patchwire && node -e "const y=require('js-yaml'); y.load(require('fs').readFileSync('.github/workflows/desktop-release.yml','utf8')); console.log('YAML OK')" 2>/dev/null || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/desktop-release.yml')); print('YAML OK')" 2>/dev/null || echo "no yaml parser — confirm 2-space indent, no tabs"`
Expected: `YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/desktop-release.yml
git commit -m "ci(desktop): fail the release if the tag version doesn't match package.json/tauri.conf"
```

---

## Final verification

- [ ] `node --test scripts/desktop-release-version.test.mjs` — 6 tests pass.
- [ ] `node scripts/release-desktop.mjs --check desktop-v0.4.0` → exit 0; `--check desktop-v9.9.9` → exit 1.
- [ ] YAML parses; the verify step is present and tag-gated.
- [ ] LIVE (user, next release): `pnpm release:desktop 0.5.0` → bumps + commits + tags; `git push origin desktop-v0.5.0` → CI verify passes → builds + publishes; site (after deploy) links to `desktop-v0.5.0`.

---

## Self-Review notes (spec → tasks)

- Pure helpers (`isSemver`, `versionFromTag`, `bumpJsonVersion`, `readDesktopVersions`, `checkVersions`) → Task 1.
- CLI bump mode (validate, dirty/tag guards, bump pkg+conf, commit, tag, print push) + `--check` mode → Task 2.
- Root `release:desktop` alias → Task 2.
- CI guard (tag-gated verify step) → Task 3.
- Live-verify items (bump-mode git ops, real release run) clearly marked.
- Names consistent: `PKG_PATH`/`CONF_PATH`, `isSemver`, `versionFromTag`, `bumpJsonVersion`, `readDesktopVersions`, `checkVersions`; tag form `desktop-v<X.Y.Z>`; script `scripts/release-desktop.mjs`; alias `release:desktop`.
```
