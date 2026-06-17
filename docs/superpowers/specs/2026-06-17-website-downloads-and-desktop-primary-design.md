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
| Positioning | **Desktop = primary**; VS Code extension = companion. |
| Targets built | mac **Apple-Silicon** (aarch64), Windows x64, Linux x86_64. Intel-mac / arm-linux NOT built (stated on the page). |
| Signing | Installers stay **unsigned** (v1). The page carries per-OS "unsigned app" instructions. |
| Ship route | All website changes via **PR** (per `website-pr-workflow`). |

## Architecture

### A. Release pipeline — `.github/workflows/desktop-release.yml`

Restructure into **build matrix → single publish job** (avoids concurrent-release races):

1. **Trigger:** `push` on tags matching `desktop-v*` (real release), plus keep `workflow_dispatch` (manual dry-run, artifacts only — no publish).
2. **Build matrix** (existing 3 runners: mac aarch64, ubuntu x86_64, windows x64): build the installers (unchanged), then a "collect + rename to stable names" step, then `upload-artifact`.
3. **Publish job** (`needs: build`, runs once, only on a `desktop-v*` tag): `download-artifact` all 3, then:
   - Create/update the **versioned release** `desktop-v<x.y.z>` with the assets (named with version for archival, e.g. `Patchwire_0.4.0_aarch64.dmg` as Tauri emits).
   - Create/update the **`desktop-latest`** release (force-move the tag to this commit; `gh release upload --clobber`) with **stable, version-less asset names** the website links to:
     - `Patchwire-macos-aarch64.dmg`
     - `Patchwire-windows-x64-setup.exe`
     - `Patchwire-linux-x86_64.deb`
     - `Patchwire-linux-x86_64.rpm`
   - Mark `desktop-latest` as a prerelease (unsigned) so it doesn't claim GA, but keep its asset URLs stable.
- **Download URL scheme (what the website uses):** `https://github.com/rebink/remote_claude/releases/download/desktop-latest/<stable-name>`.
- Uses `softprops/action-gh-release` and/or `gh release` (GITHUB_TOKEN). No new secrets.
- **Honest scope:** this workflow can only be verified by the user pushing a `desktop-v*` tag and watching the release appear — not runnable/verifiable locally.

### B. `/download/` install hub — `packages/website/src/pages/download.astro`

- New Astro page, dark-indigo style, Head/Footer/SiteTitle reused.
- Reads the desktop version at build time: `import desktopPkg from '../../../desktop/package.json'` → shows "vX.Y.Z" (memory: build-time read, no drift).
- A shared **`downloads` constant** (single source of truth) listing each platform: `{ os, label, arch, filename, url }` where `url = \`${repo}/releases/download/desktop-latest/${filename}\``. The filenames MUST match the workflow's stable names exactly (the one fragile coupling — call it out in the plan + a comment in both files).
- **Per-OS cards:** macOS (Apple Silicon · `.dmg`), Windows (x64 · `.exe`), Linux (x86_64 · `.deb` + `.rpm`). Each card: download button + size/arch note + collapsible **"unsigned app" install steps**:
  - macOS: right-click the app → Open (or `xattr -dr com.apple.quarantine /Applications/Patchwire.app`).
  - Windows: SmartScreen → More info → Run anyway.
  - Linux: `sudo dpkg -i <file>.deb` / `sudo rpm -i <file>.rpm`.
- **OS detection (client JS):** detect platform via `navigator.userAgentData?.platform ?? navigator.platform/userAgent`; add a `.is-detected` highlight to the matching card and a top-line "Recommended for your Mac/Windows/Linux" pointer. Non-detected OSes stay visible. No arch detection for mac (Intel users told Apple-Silicon-only + a "building Intel soon" note).
- A "Prefer the editor? **Get the VS Code companion**" link → the extension install path.

### C. Homepage repositioning — `packages/website/src/pages/index.astro`

- **Hero:** lead with the desktop app. Primary CTA "**Download the app**" → `/download/`; secondary "VS Code extension" link (smaller). Eyebrow changes from "The VS Code extension" to a desktop-led line.
- **"Two ways to use it" block:** Desktop app (primary — provision a machine, manage sync, launch a claude session in your own terminal) and VS Code extension (companion — same engine inside your editor).
- Keep the rest of the structure/sections; adjust copy where it says "the extension" so the page reads desktop-first. Footer/nav gain a `/download/` link.
- Version pill: keep the extension version where it refers to the extension; the `/download/` page shows the desktop version. (Two products, two versions — don't conflate.)
- Fix the dangling `/install-extension/` reference if that page doesn't exist (verify during the plan; if missing, point the companion link at the marketplace/`vscode:` deep link instead).

## Testing / verification

- **Website:** `pnpm --filter patchwire-docs build` succeeds; `/download/` and `/` render; the `downloads` constant URLs are well-formed and the filenames match the workflow's stable names (a unit-style assertion or a documented checklist — the website has no test runner by default, so a build + a grep-consistency check between the page constant and the workflow).
- **Workflow:** YAML is valid; **live-verify only** — user pushes `desktop-v0.4.0`, confirms the `desktop-v0.4.0` + `desktop-latest` releases appear with the 4 stable-named assets, and the `/download/` buttons fetch them.
- **PR:** open a PR for the website (B+C) and the workflow (A) per `website-pr-workflow`; do not push to main.

## Out of scope (v1)

- Code signing / notarization (unsigned; page covers the warnings).
- Auto-update (Tauri updater).
- Intel-mac / arm-linux / `.AppImage` / `.msi` targets.
- Changing the extension itself or its marketplace listing.

## Build sequence (for the plan)

1. `desktop-release.yml`: matrix build+rename → single publish job → versioned release + `desktop-latest` alias with the 4 stable asset names; tag-triggered.
2. `packages/website/src/pages/download.astro`: the `downloads` constant (filenames matching step 1), per-OS cards, unsigned-install notes, OS-detection JS, desktop version from `desktop/package.json`.
3. `index.astro`: desktop-primary hero + two-ways block + companion link; nav/footer `/download/` link; resolve the `/install-extension/` reference.
4. Build the site; grep-verify the page filenames == workflow stable names; open a website PR.
