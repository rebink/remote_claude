# Website: desktop downloads + desktop-as-primary repositioning

**Date:** 2026-06-17
**Status:** Approved design, ready for plan
**Relates to:** `.github/workflows/desktop-release.yml` (current unsigned-artifact build), `packages/website/src/pages/index.astro` (extension-only landing), memory `website-pr-workflow` (website ships via PR) + `website-version-pill-drift` (versions read at build time).

---

## Goal

Make the desktop app downloadable from the website and reposition the site so the **desktop app is the primary product** and the **VS Code extension is a companion**. Three coupled pieces: (A) publish installers to public GitHub Releases, (B) a canonical `/download/` install hub, (C) homepage repositioning.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Download source | Public **GitHub Releases**. **Real semver releases** (tag `desktop-v<x.y.z>`) + a **moving `desktop-latest` alias** release the website links to (stable URLs). |
| Install hub | A dedicated **`/download/`** page (canonical). Homepage CTAs point to it. |
| Positioning | **Desktop = primary**; VS Code extension = **companion**, shown on **both** the homepage and `/download/`. |
| Asset names | A **single shared constant module** both the CI rename step and the website import — NO grep validation, no duplicated filename strings. |
| Stable filenames | Use **arm64 / x64** naming: `Patchwire-macos-arm64.dmg`, `Patchwire-windows-x64-setup.exe`, `Patchwire-linux-x64.deb`, `Patchwire-linux-x64.rpm`. |
| Integrity | CI publishes **`SHASUMS256.txt`** (SHA256 of each stable asset) to the release; `/download/` links it + shows `shasum -a 256 -c` verify steps. |
| Targets built | mac **Apple-Silicon** (arm64), Windows x64, Linux x64. Intel-mac / arm-linux NOT built (stated on the page). |
| Signing | Installers stay **unsigned** (v1). The page carries per-OS "unsigned app" instructions + **system requirements**. |
| Ship route | All website changes via **PR** (per `website-pr-workflow`). |

## Architecture

### Shared asset constant (single source of truth)

`scripts/desktop-release-assets.mjs` — the ONE place stable asset names live. Both CI (rename + upload) and the website (`/download/` cards + URLs) import it. Shape:
```js
export const repo = 'rebink/remote_claude';
export const releaseAssets = [
  { os: 'macos',   arch: 'arm64', kind: 'dmg', stable: 'Patchwire-macos-arm64.dmg',        label: 'macOS (Apple Silicon)' },
  { os: 'windows', arch: 'x64',   kind: 'nsis', stable: 'Patchwire-windows-x64-setup.exe', label: 'Windows (x64)' },
  { os: 'linux',   arch: 'x64',   kind: 'deb', stable: 'Patchwire-linux-x64.deb',          label: 'Linux · Debian/Ubuntu (.deb)' },
  { os: 'linux',   arch: 'x64',   kind: 'rpm', stable: 'Patchwire-linux-x64.rpm',          label: 'Linux · Fedora/RHEL (.rpm)' },
];
export const downloadUrl = (stable) => `https://github.com/${repo}/releases/download/desktop-latest/${stable}`;
export const SHASUMS = 'SHASUMS256.txt';
```
CI maps each built Tauri bundle (by `os`+`kind`) to its `stable` name; the website maps each entry to a card + `downloadUrl(stable)`. Filenames can never drift because there is only one definition.

### A. Release pipeline — `.github/workflows/desktop-release.yml`

Restructure into **build matrix → single publish job** (avoids concurrent-release races):

1. **Trigger:** `push` on tags matching `desktop-v*` (real release), plus keep `workflow_dispatch` (manual dry-run, artifacts only — no publish).
2. **Build matrix** (existing 3 runners: mac aarch64, ubuntu x86_64, windows x64): build the installers (unchanged), then a "collect + rename to stable names" step, then `upload-artifact`.
3. **Publish job** (`needs: build`, runs once, only on a `desktop-v*` tag): `download-artifact` all 3, then:
   - Create/update the **versioned release** `desktop-v<x.y.z>` with the assets (named with version for archival, e.g. `Patchwire_0.4.0_aarch64.dmg` as Tauri emits).
   - Create/update the **`desktop-latest`** release (force-move the tag to this commit; `gh release upload --clobber`) with the **stable, version-less asset names from the shared constant** (`releaseAssets[].stable` — arm64/x64). A node step imports `scripts/desktop-release-assets.mjs` and renames each built bundle to its `stable` name (no hardcoded strings in the YAML).
   - Compute **SHA256** of each stable asset and write **`SHASUMS256.txt`**; upload it to both releases.
   - Mark `desktop-latest` as a prerelease (unsigned) so it doesn't claim GA, but keep its asset URLs stable.
- **Download URL scheme (what the website uses):** `downloadUrl(stable)` from the shared constant → `https://github.com/rebink/remote_claude/releases/download/desktop-latest/<stable>`.
- Uses `softprops/action-gh-release` and/or `gh release` (GITHUB_TOKEN). No new secrets.
- **Honest scope:** this workflow can only be verified by the user pushing a `desktop-v*` tag and watching the release appear — not runnable/verifiable locally.

### B. `/download/` install hub — `packages/website/src/pages/download.astro`

- New Astro page, dark-indigo style, Head/Footer/SiteTitle reused.
- Reads the desktop version at build time: `import desktopPkg from '../../../desktop/package.json'` → shows "vX.Y.Z" (memory: build-time read, no drift).
- **Imports `releaseAssets` + `downloadUrl` from `scripts/desktop-release-assets.mjs`** (the shared constant) — the cards/URLs derive from it, so they can't drift from CI.
- **Per-OS cards** (from `releaseAssets`): macOS (Apple Silicon · `.dmg`), Windows (x64 · `.exe`), Linux (x64 · `.deb` + `.rpm`). Each card: download button + arch note + **system requirements** + collapsible **"unsigned app" install steps**:
  - macOS: macOS 11+ (Apple Silicon). Right-click the app → Open (or `xattr -dr com.apple.quarantine /Applications/Patchwire.app`).
  - Windows: Windows 10/11 (x64). SmartScreen → More info → Run anyway.
  - Linux: x86_64, WebKit2GTK 4.1. `sudo dpkg -i <file>.deb` / `sudo rpm -i <file>.rpm`.
- **Integrity:** a "Verify your download" block linking `SHASUMS256.txt` (on the release) + `shasum -a 256 -c SHASUMS256.txt`.
- **OS detection (client JS):** detect platform via `navigator.userAgentData?.platform ?? navigator.platform/userAgent`; add a `.is-detected` highlight to the matching card and a top "Recommended for your Mac/Windows/Linux" pointer. Non-detected OSes stay visible. No arch detection for mac (Intel users told Apple-Silicon-only).
- **Companion:** a "Prefer your editor? **Get the VS Code companion**" block → the extension install path. (Extension appears as a companion here AND on the homepage.)

### C. Homepage repositioning — `packages/website/src/pages/index.astro`

- **Hero:** lead with the desktop app. Primary CTA "**Download the app**" → `/download/`; secondary "VS Code extension" link (smaller). Eyebrow changes from "The VS Code extension" to a desktop-led line.
- **"Two ways to use it" block:** Desktop app (primary — provision a machine, manage sync, launch a claude session in your own terminal) and VS Code extension (companion — same engine inside your editor).
- Keep the rest of the structure/sections; adjust copy where it says "the extension" so the page reads desktop-first. Footer/nav gain a `/download/` link.
- Version pill: keep the extension version where it refers to the extension; the `/download/` page shows the desktop version. (Two products, two versions — don't conflate.)
- Fix the dangling `/install-extension/` reference if that page doesn't exist (verify during the plan; if missing, point the companion link at the marketplace/`vscode:` deep link instead).

## Testing / verification

- **Shared constant:** because CI and the website both import `scripts/desktop-release-assets.mjs`, the filenames are identical by construction — no grep/consistency check needed. A tiny unit test (vitest, if the website/CLI runner is handy, else a node assert script) covers `downloadUrl()` shape + that every `releaseAssets[].stable` is unique and non-empty.
- **Website:** `pnpm --filter patchwire-docs build` succeeds; `/download/` and `/` render; the cards derive from `releaseAssets`.
- **Workflow:** YAML is valid; **live-verify only** — user pushes `desktop-v0.4.0`, confirms the `desktop-v0.4.0` + `desktop-latest` releases appear with the 4 stable-named assets, and the `/download/` buttons fetch them.
- **PR:** open a PR for the website (B+C) and the workflow (A) per `website-pr-workflow`; do not push to main.

## Out of scope (v1)

- Code signing / notarization (unsigned; page covers the warnings).
- Auto-update (Tauri updater).
- Intel-mac / arm-linux / `.AppImage` / `.msi` targets.
- Changing the extension itself or its marketplace listing.

## Build sequence (for the plan)

1. `scripts/desktop-release-assets.mjs` — the shared constant (`releaseAssets`, `downloadUrl`, `repo`, `SHASUMS`) + a tiny test (unique/non-empty `stable`, `downloadUrl` shape).
2. `desktop-release.yml`: matrix build → rename via the shared constant → single publish job → versioned release + `desktop-latest` alias + `SHASUMS256.txt`; tag-triggered (`desktop-v*`), `workflow_dispatch` stays artifacts-only.
3. `packages/website/src/pages/download.astro`: import the shared constant → per-OS cards (download + arch + system requirements + unsigned-install steps), integrity/SHASUMS block, OS-detection JS, desktop version from `desktop/package.json`, VS Code companion block.
4. `index.astro`: desktop-primary hero (CTA → `/download/`) + two-ways block + extension-as-companion; nav/footer `/download/` link; resolve the `/install-extension/` reference.
5. Build the site (`pnpm --filter patchwire-docs build`); open a website PR (per `website-pr-workflow`).
