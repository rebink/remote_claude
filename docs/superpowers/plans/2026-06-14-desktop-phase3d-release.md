# Desktop Phase 3d-i — unsigned cross-OS release pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CI workflow that builds the desktop app's bundled CLI sidecar + **unsigned** Tauri installers for macOS/Linux/Windows and publishes them as downloadable artifacts — verifiable via a manual run, without cutting an npm/marketplace release.

**Architecture:** A new `scripts/build-cli-binaries.mjs` bun-compiles `packages/cli/src/cli.ts` to per-OS binaries (mirrors the existing agent-binary script). `stage-sidecar.mjs --from-release` (Phase 1) maps those to Tauri's `patchwire-<target-triple>` sidecar names; its name→triple matcher is widened to match `<os>-<arch>` substrings so it works for the CLI assets too. A dedicated `desktop-release.yml` workflow (manual `workflow_dispatch`) runs a 3-OS matrix: build CLI binaries → stage sidecar → `tauri build` (unsigned) → upload installers as artifacts. **No npm/marketplace publish** (that stays in `release.yml`), so the build is safe to run repeatedly.

**Tech Stack:** GitHub Actions, bun (`--compile`), Rust/Cargo, Tauri v2 CLI, Node/pnpm, vitest. Linux built on **ubuntu-22.04** (glibc/WebKitGTK 4.1 baseline, per the spike findings).

**Scope:** 3d-i = **unsigned** pipeline + artifacts only. **Deferred to 3d-ii (needs your certs):** macOS Developer-ID signing + notarization, Windows code-signing, and wiring the desktop build into the tagged `release.yml`. Stronghold is 3c.

**Verification reality (read this):** unlike Phases 0–3b, the binary production (bun `--compile`) and the Tauri cross-OS build run **only in CI** — they can't be exercised on this dev machine (no bun locally; Tauri builds are per-OS). So: the **pure pieces are TDD'd locally** (the CLI target table; the sidecar name→triple mapping; a `--from-release` dry run with fake files), the **workflow YAML is syntax-validated** locally, and the **real cross-OS build is verified by one `workflow_dispatch` CI run** that produces unsigned installer artifacts. Do NOT push a git tag to verify — that triggers `release.yml` (npm + marketplace publish).

**Prerequisites:** Phases through 3b-ii merged to `main`. Work on a branch off `main`.

---

## File structure

```
scripts/build-cli-binaries.mjs                       # bun --compile cli.ts × targets  [target table TDD]
scripts/build-cli-binaries.test.mjs
packages/desktop/scripts/stage-sidecar.mjs           # widen bunTargetToTriple to <os>-<arch> substrings
packages/desktop/scripts/stage-sidecar.test.mjs       # + CLI-asset-name mapping cases
.github/workflows/desktop-release.yml                 # workflow_dispatch matrix → unsigned installers (artifacts)
```

---

### Task 1: Widen the sidecar name→triple matcher (TDD)

**Files:** Modify `packages/desktop/scripts/stage-sidecar.mjs`, `packages/desktop/scripts/stage-sidecar.test.mjs`.

The Phase-1 `bunTargetToTriple` keys are `bun-darwin-arm64`-style and match as substrings. The CLI release assets will be named `patchwire-cli-darwin-arm64` (no `bun-` prefix), so widen the keys to the `<os>-<arch>` portion — still a substring of the old `bun-*` names, so existing cases keep passing.

- [ ] **Step 1: Add failing tests for CLI-asset names**

Append to `packages/desktop/scripts/stage-sidecar.test.mjs`:
```js
it.each([
  ['patchwire-cli-darwin-arm64', 'aarch64-apple-darwin'],
  ['patchwire-cli-darwin-x64', 'x86_64-apple-darwin'],
  ['patchwire-cli-linux-x64', 'x86_64-unknown-linux-gnu'],
  ['patchwire-cli-linux-arm64', 'aarch64-unknown-linux-gnu'],
  ['patchwire-cli-windows-x64.exe', 'x86_64-pc-windows-msvc'],
])('maps CLI asset %s -> %s', (asset, triple) => {
  expect(bunTargetToTriple(asset)).toBe(triple);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/desktop && node_modules/.bin/vitest run scripts/stage-sidecar.test.mjs`
Expected: FAIL (asset names contain no `bun-…` key substring).

- [ ] **Step 3: Widen the key table**

In `packages/desktop/scripts/stage-sidecar.mjs`, change `BUN_TO_TRIPLE` keys to the `<os>-<arch>` portion:
```js
const BUN_TO_TRIPLE = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'windows-x64': 'x86_64-pc-windows-msvc',
};
```
IMPORTANT ordering: `darwin-arm64` must be checked before any `darwin` and `linux-arm64` before `linux-x64` — the keys above are already arm64-before-x64, and `Object.keys` preserves insertion order, so `find((k) => name.includes(k))` matches the more specific arm64 key first for an arm64 asset. (A `linux-x64` asset doesn't contain `linux-arm64`, so order only matters for not accidentally matching a shorter key — these keys don't overlap that way, but keep arm64 first as defense.)

- [ ] **Step 4: Run, expect PASS (old + new cases)**

Run: `cd packages/desktop && node_modules/.bin/vitest run scripts/stage-sidecar.test.mjs`
Expected: PASS (the original `bun-darwin-arm64` cases still pass via substring; the 5 new CLI-asset cases pass).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/scripts/stage-sidecar.mjs packages/desktop/scripts/stage-sidecar.test.mjs
git commit -m "feat(desktop): widen sidecar name->triple matcher to os-arch (CLI assets)"
```

---

### Task 2: `build-cli-binaries.mjs` (CLI sidecar binaries)

**Files:** Create `scripts/build-cli-binaries.mjs`, Test `scripts/build-cli-binaries.test.mjs`.

Mirrors `scripts/build-agent-binaries.mjs` but compiles the **CLI** entrypoint (`packages/cli/src/cli.ts`) and names outputs `patchwire-cli-<os>-<arch>` so `stage-sidecar --from-release` maps them. The pure **target table** is unit-tested; the bun compile runs in CI.

- [ ] **Step 1: Write the failing test (pure target table)**

Create `scripts/build-cli-binaries.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { TARGETS } from './build-cli-binaries.mjs';

describe('CLI binary targets', () => {
  it('covers the 5 supported os/arch with bun targets + asset names', () => {
    const byKey = Object.fromEntries(TARGETS.map((t) => [t.key, t]));
    expect(byKey['darwin-arm64']).toMatchObject({ target: 'bun-darwin-arm64', asset: 'patchwire-cli-darwin-arm64' });
    expect(byKey['linux-x64']).toMatchObject({ target: 'bun-linux-x64', asset: 'patchwire-cli-linux-x64' });
    expect(byKey['windows-x64']).toMatchObject({ target: 'bun-windows-x64', asset: 'patchwire-cli-windows-x64.exe' });
  });
  it('windows asset has .exe, posix assets do not', () => {
    for (const t of TARGETS) {
      if (t.key.startsWith('windows')) expect(t.asset.endsWith('.exe')).toBe(true);
      else expect(t.asset.endsWith('.exe')).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd /Users/apple/Documents/Workspace/patchwire && node_modules/.bin/vitest run scripts/build-cli-binaries.test.mjs`
(If the repo root has no vitest binary, use `packages/cli/node_modules/.bin/vitest`.) Expected: FAIL (module missing).

- [ ] **Step 3: Implement `build-cli-binaries.mjs`**

Create `scripts/build-cli-binaries.mjs`:
```js
#!/usr/bin/env node
// Bun-compile the patchwire CLI to standalone per-OS binaries for the desktop sidecar.
// Mirrors build-agent-binaries.mjs but compiles cli.ts and names outputs patchwire-cli-<os>-<arch>.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = [
  { target: 'bun-darwin-arm64', asset: 'patchwire-cli-darwin-arm64', key: 'darwin-arm64' },
  { target: 'bun-darwin-x64', asset: 'patchwire-cli-darwin-x64', key: 'darwin-x64' },
  { target: 'bun-linux-arm64', asset: 'patchwire-cli-linux-arm64', key: 'linux-arm64' },
  { target: 'bun-linux-x64', asset: 'patchwire-cli-linux-x64', key: 'linux-x64' },
  { target: 'bun-windows-x64', asset: 'patchwire-cli-windows-x64.exe', key: 'windows-x64' },
];

// CLI entry point + output dir, relative to repo root (this file is in scripts/).
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'packages', 'cli', 'src', 'cli.ts');
const outDir = join(root, 'dist-cli-bin');

function main() {
  mkdirSync(outDir, { recursive: true });
  const built = [];
  for (const { target, asset, key } of TARGETS) {
    const outfile = join(outDir, asset);
    console.log(`Building ${asset} (${target}) …`);
    const r = spawnSync('bun', ['build', '--compile', `--target=${target}`, '--outfile', outfile, entry], { stdio: 'inherit' });
    if (r.status !== 0) { console.error(`bun build failed for ${target}`); process.exit(1); }
    built.push({ key, asset, bytes: readFileSync(outfile).length });
  }
  const version = JSON.parse(readFileSync(join(root, 'packages', 'cli', 'package.json'), 'utf8')).version;
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ version, binaries: built }, null, 2) + '\n');
  console.log(`Wrote dist-cli-bin/manifest.json (version ${version}, ${TARGETS.length} CLI binaries)`);
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd /Users/apple/Documents/Workspace/patchwire && node_modules/.bin/vitest run scripts/build-cli-binaries.test.mjs` (or the `packages/cli` vitest binary).
Expected: PASS (2). (The bun compile itself is exercised only in CI — bun isn't installed locally.)

- [ ] **Step 5: Smoke the dry mapping (no bun): stage-sidecar --from-release with fake files**

Run:
```bash
cd /Users/apple/Documents/Workspace/patchwire
mkdir -p /tmp/pw-fake-cli-bin && (cd /tmp/pw-fake-cli-bin && : > patchwire-cli-darwin-arm64 && : > patchwire-cli-linux-x64 && : > patchwire-cli-windows-x64.exe)
node packages/desktop/scripts/stage-sidecar.mjs --from-release /tmp/pw-fake-cli-bin
ls packages/desktop/src-tauri/binaries/ | grep patchwire-
```
Expected: `patchwire-aarch64-apple-darwin`, `patchwire-x86_64-unknown-linux-gnu`, `patchwire-x86_64-pc-windows-msvc.exe` produced (proves the release→sidecar staging path end-to-end without bun). Clean up: `rm -rf /tmp/pw-fake-cli-bin packages/desktop/src-tauri/binaries/patchwire-*`.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-cli-binaries.mjs scripts/build-cli-binaries.test.mjs
git commit -m "feat(release): build-cli-binaries.mjs — bun-compile the CLI sidecar per OS"
```

---

### Task 3: `desktop-release.yml` (workflow_dispatch, unsigned installers)

**Files:** Create `.github/workflows/desktop-release.yml`.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/desktop-release.yml`:
```yaml
name: Desktop Release (unsigned)

# Manual only — builds unsigned installers as artifacts. Does NOT publish to npm/marketplace
# (that is release.yml, on tag). Safe to run repeatedly.
on:
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            triple: aarch64-apple-darwin
          - os: ubuntu-22.04
            triple: x86_64-unknown-linux-gnu
          - os: windows-latest
            triple: x86_64-pc-windows-msvc
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

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

      - name: Build the CLI sidecar binaries (bun --compile)
        run: node scripts/build-cli-binaries.mjs

      - name: Stage the sidecar for this platform
        run: node packages/desktop/scripts/stage-sidecar.mjs --from-release dist-cli-bin

      - name: Build the desktop app (unsigned)
        run: pnpm --filter patchwire-desktop tauri build

      - name: Collect installers
        shell: bash
        run: |
          mkdir -p out
          cp -r packages/desktop/src-tauri/target/release/bundle/* out/ 2>/dev/null || true

      - uses: actions/upload-artifact@v4
        with:
          name: patchwire-desktop-${{ matrix.triple }}
          path: out/**
          if-no-files-found: warn
```
Notes (do not omit): `fail-fast: false` so one OS failing doesn't cancel the others (expected during first-run shakeout); `pnpm tauri build` runs the desktop `beforeBuildCommand` (vite build) automatically; the sidecar must be staged BEFORE `tauri build` (externalBin is resolved at build time). No signing env → unsigned bundles.

- [ ] **Step 2: Validate the YAML locally**

Run: `node -e "const y=require('js-yaml'); y.load(require('fs').readFileSync('.github/workflows/desktop-release.yml','utf8')); console.log('yaml ok')"` — if `js-yaml` isn't available, use `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/desktop-release.yml')); print('yaml ok')"`.
Expected: `yaml ok`. (Optional, if installed: `actionlint .github/workflows/desktop-release.yml`.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/desktop-release.yml
git commit -m "ci(desktop): desktop-release.yml — unsigned cross-OS installers (workflow_dispatch)"
```

---

### Task 4: Verification (local gates + CI dispatch)

**Files:** none (verification; document the result).

- [ ] **Step 1: Local gates**

Run:
```bash
cd /Users/apple/Documents/Workspace/patchwire
node_modules/.bin/vitest run scripts/build-cli-binaries.test.mjs 2>/dev/null || (cd packages/cli && node_modules/.bin/vitest run ../../scripts/build-cli-binaries.test.mjs)
cd packages/desktop && node_modules/.bin/vitest run scripts/stage-sidecar.test.mjs
```
Expected: both green (target table + widened mapping incl. CLI-asset cases).

- [ ] **Step 2: CI dispatch (the real cross-OS verification)**

Push the branch, then trigger the workflow on it (no tag, no publish):
```bash
git push -u origin <this-branch>
gh workflow run "Desktop Release (unsigned)" --ref <this-branch>
gh run watch "$(gh run list --workflow 'desktop-release.yml' -L1 --json databaseId -q '.[0].databaseId')"
```
Expected: three matrix jobs; each uploads `patchwire-desktop-<triple>` artifacts (`.dmg`/`.app` on macOS, `.deb`/`.AppImage` on Linux, `.msi`/`.exe` on Windows). First run will likely need 1–2 fixes (Tauri/apt/bun-cross-compile quirks) — iterate on the YAML. Download an artifact and confirm it's a real installer.
**This is the gating verification** — the local gates only prove the scripts, not the cross-OS build.

- [ ] **Step 3: Record + commit**

Append a "Phase 3d-i verified" note (date + the CI run URL + which OS artifacts built) to a new `docs/superpowers/validation/2026-06-14-desktop-phase3d.md`. Note any per-OS quirks fixed. Commit.

---

## Self-review notes

- **Spec coverage:** delivers the **unsigned** release pipeline (CLI sidecar binaries + cross-OS Tauri installers as CI artifacts) — the agreed internal-team build. **Signing/notarization + wiring into the tagged `release.yml` are explicitly deferred to 3d-ii (needs your certs).**
- **Placeholder scan:** every step has concrete code/commands. `<this-branch>` in Task 4 is a deliberate fill-in (the executor's actual branch name), not a content gap.
- **Type consistency:** `build-cli-binaries.mjs` asset names (`patchwire-cli-<os>-<arch>`) match the widened `bunTargetToTriple` keys (`<os>-<arch>`) consumed by `stage-sidecar --from-release`, which emits `patchwire-<triple>` — the exact name Tauri's `externalBin: ["binaries/patchwire"]` expects. bun targets (`bun-<os>-<arch>`) match the existing agent script's convention.
- **Verification honesty:** the bun `--compile` and Tauri cross-OS build are **CI-only**; locally we prove the target table, the name→triple mapping, and a fake-file `--from-release` staging. The cross-OS installer build is gated on a `workflow_dispatch` run (no tag → no npm/marketplace publish). A git tag must NOT be used to verify.
- **Risk:** first CI run will likely need YAML iteration (apt deps, bun cross-compile availability per-runner, Tauri bundle paths per-OS). That's expected and is why the workflow is `workflow_dispatch` + `fail-fast: false` — cheap to re-run without side effects.
