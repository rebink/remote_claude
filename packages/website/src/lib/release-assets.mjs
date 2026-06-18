// packages/website/src/lib/release-assets.mjs
// SINGLE SOURCE OF TRUTH for desktop installer asset names. Imported by BOTH the
// release CI (.github/workflows/release.yml, desktop rename + upload step) and the
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
