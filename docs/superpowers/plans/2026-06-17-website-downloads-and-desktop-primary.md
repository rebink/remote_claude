# Website Desktop Downloads + Desktop-Primary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app downloadable from a canonical `/download/` hub, reposition the site so the desktop app is primary and the VS Code extension is a companion, and publish installers to GitHub Releases (semver + a moving `desktop-latest` alias) using a single shared asset-name constant.

**Architecture:** One shared `.mjs` constant defines the stable asset names; CI (`desktop-release.yml`) and the website both import it (no drift). CI builds per-OS installers, renames to the stable names, and publishes a versioned release + a `desktop-latest` alias + `SHASUMS256.txt`. The website adds `/download/` (per-OS cards, OS-detection, integrity, system requirements) and re-leads the homepage with the desktop app.

**Tech Stack:** GitHub Actions, Tauri bundler, Astro + Starlight (website), node:test. Spec: `docs/superpowers/specs/2026-06-17-website-downloads-and-desktop-primary-design.md`.

**Ship route:** website + workflow land via a **PR** (memory `website-pr-workflow`), not a push to main. The CI workflow and real downloads are **live-verify only** (cannot run GitHub Actions or build cross-OS installers locally).

**Location note (deviation from spec):** the shared constant lives at `packages/website/src/lib/release-assets.mjs` (not repo `scripts/`) so Astro/Vite imports it without `fs.allow` issues; CI imports it by path from repo root. Same single-source-of-truth guarantee.

---

## File Structure

- Create: `packages/website/src/lib/release-assets.mjs` — shared constant (`repo`, `releaseAssets`, `downloadUrl`, `SHASUMS`).
- Create: `packages/website/src/lib/release-assets.test.mjs` — node:test.
- Modify: `.github/workflows/desktop-release.yml` — rename via the constant, publish releases + alias + shasums.
- Create: `packages/website/src/pages/download.astro` — the install hub.
- Modify: `packages/website/src/pages/index.astro` — desktop-primary hero + companion + nav `/download/`.

**Test commands:** `node --test packages/website/src/lib/release-assets.test.mjs`; site build `pnpm --filter patchwire-docs build`.

---

## Task 1: Shared asset constant + test

**Files:**
- Create: `packages/website/src/lib/release-assets.mjs`
- Create: `packages/website/src/lib/release-assets.test.mjs`

- [ ] **Step 1: Write the test**

```js
// packages/website/src/lib/release-assets.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseAssets, downloadUrl, repo, SHASUMS } from "./release-assets.mjs";

test("repo + SHASUMS are set", () => {
  assert.equal(repo, "rebink/remote_claude");
  assert.equal(SHASUMS, "SHASUMS256.txt");
});

test("every asset has a unique, non-empty stable name and known os/kind", () => {
  const seen = new Set();
  const oses = new Set(["macos", "windows", "linux"]);
  for (const a of releaseAssets) {
    assert.ok(a.stable && typeof a.stable === "string", "stable name");
    assert.ok(!seen.has(a.stable), `duplicate stable name ${a.stable}`);
    seen.add(a.stable);
    assert.ok(oses.has(a.os), `bad os ${a.os}`);
    assert.ok(a.label && a.kind && a.arch, "label/kind/arch");
  }
  assert.equal(releaseAssets.length, 4);
});

test("downloadUrl points at the desktop-latest alias", () => {
  assert.equal(
    downloadUrl("Patchwire-macos-arm64.dmg"),
    "https://github.com/rebink/remote_claude/releases/download/desktop-latest/Patchwire-macos-arm64.dmg",
  );
});

test("stable names use arm64/x64 convention", () => {
  const names = releaseAssets.map((a) => a.stable);
  assert.deepEqual(names.sort(), [
    "Patchwire-linux-x64.deb",
    "Patchwire-linux-x64.rpm",
    "Patchwire-macos-arm64.dmg",
    "Patchwire-windows-x64-setup.exe",
  ]);
});
```

- [ ] **Step 2: Run → FAIL**

Run: `cd /Users/apple/Documents/Workspace/patchwire && node --test packages/website/src/lib/release-assets.test.mjs`
Expected: FAIL — cannot find module `./release-assets.mjs`.

- [ ] **Step 3: Implement**

```js
// packages/website/src/lib/release-assets.mjs
// SINGLE SOURCE OF TRUTH for desktop installer asset names. Imported by BOTH the
// release CI (.github/workflows/desktop-release.yml, rename + upload step) and the
// website (/download/ cards + URLs) so the filenames can never drift.

export const repo = "rebink/remote_claude";
export const SHASUMS = "SHASUMS256.txt";

/**
 * Each built Tauri bundle, mapped to a stable version-less asset name. `os`+`kind`
 * identify which built file to rename; `stable` is the published name; `label`/`arch`
 * are shown on the download page.
 */
export const releaseAssets = [
  { os: "macos",   arch: "arm64", kind: "dmg",  stable: "Patchwire-macos-arm64.dmg",        label: "macOS (Apple Silicon)" },
  { os: "windows", arch: "x64",   kind: "nsis", stable: "Patchwire-windows-x64-setup.exe",  label: "Windows (x64)" },
  { os: "linux",   arch: "x64",   kind: "deb",  stable: "Patchwire-linux-x64.deb",          label: "Linux · Debian/Ubuntu (.deb)" },
  { os: "linux",   arch: "x64",   kind: "rpm",  stable: "Patchwire-linux-x64.rpm",          label: "Linux · Fedora/RHEL (.rpm)" },
];

/** Stable download URL via the moving `desktop-latest` alias release. */
export const downloadUrl = (stable) =>
  `https://github.com/${repo}/releases/download/desktop-latest/${stable}`;
```

- [ ] **Step 4: Run → PASS** (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/website/src/lib/release-assets.mjs packages/website/src/lib/release-assets.test.mjs
git commit -m "feat(website): shared desktop release-asset constant (single source of truth)"
```

---

## Task 2: Release workflow — publish releases + desktop-latest alias + shasums

**Files:**
- Modify: `.github/workflows/desktop-release.yml`

**Cannot be run locally** (GitHub Actions). Verification = YAML validity + the user pushing a `desktop-v*` tag later. Read the current `desktop-release.yml` first (it has the 3-OS build matrix uploading artifacts).

- [ ] **Step 1: Replace the workflow with this**

```yaml
name: Desktop Release

# Tag-triggered real release (desktop-v*) → versioned release + moving desktop-latest
# alias. workflow_dispatch stays a dry run (artifacts only, no publish).
on:
  push:
    tags:
      - "desktop-v*"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
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
            import("./packages/website/src/lib/release-assets.mjs").then(({ releaseAssets }) => {
              const fs = require("fs");
              const cp = require("child_process");
              const bundleDir = "packages/desktop/src-tauri/target/release/bundle";
              // glob each bundle file by extension under the bundle dir
              const findByExt = (ext) =>
                cp.execSync(`find ${bundleDir} -type f -name "*.${ext}"`).toString().trim().split("\n").filter(Boolean);
              const extFor = { dmg: "dmg", nsis: "exe", deb: "deb", rpm: "rpm" };
              for (const a of releaseAssets.filter((a) => a.os === process.env.ASSET_OS)) {
                const matches = findByExt(extFor[a.kind]);
                if (!matches.length) { console.log(`no ${a.kind} bundle found, skipping ${a.stable}`); continue; }
                fs.copyFileSync(matches[0], `out/${a.stable}`);
                console.log(`out/${a.stable} <- ${matches[0]}`);
              }
            });
          '
        env:
          ASSET_OS: ${{ matrix.assetOs }}

      - uses: actions/upload-artifact@v4
        with:
          name: patchwire-desktop-${{ matrix.assetOs }}
          path: out/**
          if-no-files-found: warn

  publish:
    needs: build
    if: startsWith(github.ref, 'refs/tags/desktop-v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
      - name: Flatten + checksum
        shell: bash
        run: |
          mkdir -p release
          find artifacts -type f -exec cp {} release/ \;
          cd release && sha256sum * > SHASUMS256.txt && cat SHASUMS256.txt

      - name: Publish versioned release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: ${{ github.ref_name }}
          prerelease: true
          files: release/*

      - name: Move desktop-latest alias to this build
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        shell: bash
        run: |
          gh release delete desktop-latest --yes --cleanup-tag || true
          gh release create desktop-latest release/* \
            --title "Desktop (latest)" \
            --notes "Rolling latest desktop build (unsigned). Same assets as ${{ github.ref_name }}." \
            --prerelease \
            --target "$GITHUB_SHA"
```

- [ ] **Step 2: Validate the YAML**

Run: `cd /Users/apple/Documents/Workspace/patchwire && node -e "const y=require('fs').readFileSync('.github/workflows/desktop-release.yml','utf8'); require('child_process'); console.log('lines', y.split('\n').length)" && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/desktop-release.yml')); print('YAML OK')" 2>/dev/null || echo "python yaml check unavailable — visually confirm indentation"`
Expected: `YAML OK` (or a note that the checker is unavailable — then eyeball the indentation).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/desktop-release.yml
git commit -m "ci(desktop): publish semver release + desktop-latest alias + SHASUMS256 via shared asset names"
```

---

## Task 3: `/download/` install hub page

**Files:**
- Create: `packages/website/src/pages/download.astro`

Read `packages/website/src/pages/index.astro` head/import section + `src/components/Head.astro` / `Footer.astro` first to mirror the page shell (`<html class="rc-brand rc-dark">`, custom.css import, Head/Footer usage).

- [ ] **Step 1: Create `download.astro`**

```astro
---
import '../styles/custom.css';
import Head from '../components/Head.astro';
import Footer from '../components/Footer.astro';
import { releaseAssets, downloadUrl, repo, SHASUMS } from '../lib/release-assets.mjs';
import desktopPkg from '../../../desktop/package.json';

const version = desktopPkg.version;
const extDeepLink = 'vscode:extension/patchwire.patchwire-vscode';
const shasumsUrl = `https://github.com/${repo}/releases/download/desktop-latest/${SHASUMS}`;

// System requirements + unsigned-install notes per OS.
const reqs = {
  macos: 'macOS 11 Big Sur or later · Apple Silicon (M1+).',
  windows: 'Windows 10/11 · 64-bit.',
  linux: 'x86_64 · WebKit2GTK 4.1 (libwebkit2gtk-4.1).',
};
const installNotes = {
  macos: 'Unsigned: right-click Patchwire.app → Open (once), or run `xattr -dr com.apple.quarantine /Applications/Patchwire.app`.',
  windows: 'Unsigned: SmartScreen → “More info” → “Run anyway”.',
  linux: 'Install with `sudo dpkg -i <file>.deb` or `sudo rpm -i <file>.rpm`.',
};
---

<!doctype html>
<html lang="en" class="rc-brand rc-dark">
  <head>
    <Head title="Download Patchwire" description="Download the Patchwire desktop app for macOS, Windows, and Linux." />
  </head>
  <body class="page">
    <main id="main" class="dl">
      <header class="dl-head">
        <a class="dl-back" href="/">← Patchwire</a>
        <span class="dl-ver">desktop v{version} · unsigned</span>
      </header>

      <h1 class="dl-title">Download Patchwire</h1>
      <p class="dl-sub">The desktop app — provision a machine you own, manage sync, and launch a Claude Code session in your terminal. Pick your platform:</p>

      <div class="dl-grid" id="dl-grid">
        {releaseAssets.map((a) => (
          <article class={`dl-card dl-${a.os}`} data-os={a.os}>
            <div class="dl-card-top">
              <span class="dl-os">{a.label}</span>
            </div>
            <a class="dl-btn" href={downloadUrl(a.stable)} download>Download {a.stable.endsWith('.rpm') ? '.rpm' : a.stable.endsWith('.deb') ? '.deb' : a.stable.split('.').pop()}</a>
            <p class="dl-req">{reqs[a.os]}</p>
            <details class="dl-notes"><summary>Install notes</summary><p>{installNotes[a.os]}</p></details>
          </article>
        ))}
      </div>

      <section class="dl-verify">
        <h2>Verify your download</h2>
        <p>Checksums: <a href={shasumsUrl}>{SHASUMS}</a>. Then run:</p>
        <pre><code>shasum -a 256 -c {SHASUMS}</code></pre>
      </section>

      <section class="dl-companion">
        <h2>Prefer your editor?</h2>
        <p>The <strong>VS Code companion</strong> runs the same engine inside your editor.
          <a href={extDeepLink}>Install for VS Code</a> · <a href="/install-extension/">other ways ↗</a></p>
      </section>
    </main>
    <Footer />

    <script is:inline>
      // Highlight the visitor's platform card; non-matching cards stay visible.
      (function () {
        var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent;
        p = String(p).toLowerCase();
        var os = p.indexOf('mac') > -1 ? 'macos' : p.indexOf('win') > -1 ? 'windows' : p.indexOf('linux') > -1 ? 'linux' : '';
        if (!os) return;
        document.querySelectorAll('.dl-card[data-os="' + os + '"]').forEach(function (el) { el.classList.add('is-detected'); });
      })();
    </script>

    <style>
      .dl { max-width: 880px; margin: 0 auto; padding: 48px 24px 80px; }
      .dl-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text-muted, #9a9aa2); }
      .dl-back { color: inherit; text-decoration: none; }
      .dl-ver { font-variant-numeric: tabular-nums; }
      .dl-title { font-size: 32px; margin: 28px 0 8px; }
      .dl-sub { color: var(--text-muted, #9a9aa2); max-width: 640px; line-height: 1.6; }
      .dl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin: 32px 0; }
      .dl-card { border: 1px solid #26262c; border-radius: 12px; padding: 16px; background: #131316; display: flex; flex-direction: column; gap: 10px; }
      .dl-card.is-detected { border-color: #C9F564; box-shadow: 0 0 0 1px #C9F56455; }
      .dl-os { font-weight: 600; font-size: 14px; }
      .dl-btn { display: inline-block; text-align: center; background: #6c5cff; color: #fff; padding: 9px 12px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; }
      .dl-req { font-size: 11px; color: var(--text-muted, #9a9aa2); margin: 0; }
      .dl-notes { font-size: 11px; color: var(--text-muted, #9a9aa2); }
      .dl-notes summary { cursor: pointer; }
      .dl-verify, .dl-companion { border-top: 1px solid #26262c; padding-top: 24px; margin-top: 24px; }
      .dl-verify pre { background: #0c0c0e; border: 1px solid #26262c; border-radius: 8px; padding: 10px 12px; overflow-x: auto; font-size: 12px; }
      .dl-companion a { color: #C9F564; }
    </style>
  </body>
</html>
```
NOTE: confirm `Head.astro` accepts `title`/`description` props (read it). If its API differs, adapt the `<Head .../>` usage to match the existing one in index.astro / 404.astro. Same for `Footer.astro` (it may take no props).

- [ ] **Step 2: Build the site**

Run: `cd /Users/apple/Documents/Workspace/patchwire && pnpm --filter patchwire-docs build 2>&1 | tail -15`
Expected: build succeeds and lists `/download/` among built pages. If `astro check` errors on the `.mjs` import or `Head` props, fix the import path / prop usage and rebuild.

- [ ] **Step 3: Commit**

```bash
git add packages/website/src/pages/download.astro
git commit -m "feat(website): /download install hub (per-OS cards, checksums, system reqs, OS detect)"
```

---

## Task 4: Homepage — desktop primary, extension companion

**Files:**
- Modify: `packages/website/src/pages/index.astro`

Make targeted edits (do NOT rewrite the whole file). Read it to locate each anchor.

- [ ] **Step 1: Add a `download` href constant**

In the frontmatter (where `ext`, `installFallback` are defined), add:
```ts
const download = '/download/';
```

- [ ] **Step 2: Topbar — make Download the primary action**

Replace the topbar-right block:
```astro
      <div class="topbar-right">
        <span class="meta-pill"><span class="meta-dot"></span>v{version}</span>
        <a href={ext} class="topbar-install magnet">Install for VS Code</a>
      </div>
```
with:
```astro
      <div class="topbar-right">
        <span class="meta-pill"><span class="meta-dot"></span>v{version}</span>
        <a href={download} class="topbar-install magnet">Download the app</a>
      </div>
```
Also add a `/download/` nav link: in the `<nav>` list (where Quickstart/Teams/… are), add as the first item:
```astro
        <a href="/download/">Download</a>
```

- [ ] **Step 3: Hero — lead with the desktop app**

Replace the hero eyebrow + CTA row + fallback:
```astro
          <span class="eyebrow reveal">The VS Code extension</span>
```
with:
```astro
          <span class="eyebrow reveal">The desktop app</span>
```
Replace the hero `cta-row` + `cta-fallback`:
```astro
          <div class="cta-row reveal">
            <a href={ext} class="cta cta-primary magnet">
              <span>Install for VS Code</span><span class="cta-arrow">→</span>
            </a>
            <a href="/quickstart/" class="cta cta-ghost magnet">
              <span>Read the docs</span><span class="cta-arrow">↗</span>
            </a>
          </div>
          <p class="cta-fallback reveal">
            Opens VS Code at the extension. No VS Code, or another editor?
            <a href={installFallback}>Other ways to install ↗</a>
          </p>
```
with:
```astro
          <div class="cta-row reveal">
            <a href={download} class="cta cta-primary magnet">
              <span>Download the app</span><span class="cta-arrow">→</span>
            </a>
            <a href="/quickstart/" class="cta cta-ghost magnet">
              <span>Read the docs</span><span class="cta-arrow">↗</span>
            </a>
          </div>
          <p class="cta-fallback reveal">
            macOS · Windows · Linux. Prefer your editor?
            <a href={ext}>Get the VS Code companion ↗</a>
          </p>
```

- [ ] **Step 4: Closing CTA — desktop primary, extension companion**

Find the closing CTA near the bottom (around the "Install the extension. It runs on your machine…" copy + the `Install for VS Code` button). Replace its primary button `href={ext}` / label with the download:
```astro
            <span>Download the app</span><span class="cta-arrow">→</span>
```
and update its button `href` to `{download}`. Update the surrounding sentence from "Install the extension." to "Download the app." and change the "Opens VS Code at the extension…" fallback line to: `Prefer your editor? <a href={ext}>VS Code companion ↗</a>`. (Keep the footer `/install-extension/` link as-is — that page exists.)

- [ ] **Step 5: Build the site**

Run: `cd /Users/apple/Documents/Workspace/patchwire && pnpm --filter patchwire-docs build 2>&1 | tail -12`
Expected: build succeeds; `/` and `/download/` present.

- [ ] **Step 6: Commit**

```bash
git add packages/website/src/pages/index.astro
git commit -m "feat(website): lead with the desktop app; VS Code extension as companion"
```

---

## Task 5: Final build + open PR

- [ ] **Step 1: Full verification**

```bash
cd /Users/apple/Documents/Workspace/patchwire
node --test packages/website/src/lib/release-assets.test.mjs
pnpm --filter patchwire-docs build 2>&1 | tail -8
```
Expected: tests pass; site builds; `/download/` listed.

- [ ] **Step 2: Open a PR (website-pr-workflow — do NOT push to main)**

Push the branch and open a PR:
```bash
git push -u origin <branch>
gh pr create --title "Website: desktop downloads + desktop-primary" --body "$(cat <<'EOF'
## Summary
- /download install hub: per-OS cards (macOS arm64, Windows x64, Linux x64), OS-detection, system requirements, unsigned-install notes, SHASUMS256 verify.
- Homepage now leads with the desktop app; VS Code extension presented as a companion.
- desktop-release.yml publishes a semver release + moving desktop-latest alias + SHASUMS256, using a shared asset-name constant (single source of truth).

## Test Plan
- [ ] `node --test packages/website/src/lib/release-assets.test.mjs`
- [ ] `pnpm --filter patchwire-docs build`
- [ ] LIVE: push a `desktop-v0.4.0` tag → confirm `desktop-v0.4.0` + `desktop-latest` releases appear with the 4 stable assets + SHASUMS256.txt, and the /download buttons fetch them.
EOF
)"
```

---

## Final verification

- [ ] `node --test packages/website/src/lib/release-assets.test.mjs` — green.
- [ ] `pnpm --filter patchwire-docs build` — succeeds, `/download/` built.
- [ ] PR opened (not merged to main).
- [ ] LIVE (user): push `desktop-v*` tag → releases + assets + working downloads.

---

## Self-Review notes (spec → tasks)

- Shared constant (single source, arm64/x64) → Task 1.
- Semver release + moving desktop-latest alias + SHASUMS256 → Task 2.
- `/download/` canonical hub: per-OS cards, OS-detect, system requirements, unsigned notes, integrity → Task 3.
- Desktop primary + extension companion (homepage) → Task 4; companion on /download → Task 3.
- Ship via PR → Task 5.
- Names consistent: `releaseAssets`/`downloadUrl`/`repo`/`SHASUMS`; stable names `Patchwire-macos-arm64.dmg` / `-windows-x64-setup.exe` / `-linux-x64.deb` / `-linux-x64.rpm`; alias tag `desktop-latest`; semver tag `desktop-v*`.
- Live-verify items clearly marked (CI + real downloads).
```
