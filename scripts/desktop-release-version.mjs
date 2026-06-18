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
