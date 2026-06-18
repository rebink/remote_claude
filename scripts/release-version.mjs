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

// TS modules that inline the version as `export const VERSION = '...'` (the CLI/agent
// bundles this constant — it can't read package.json from a compiled binary at runtime).
export const TS_TARGETS = ["packages/cli/src/version.ts"];

export const TARGETS = [...JSON_TARGETS, ...TOML_TARGETS, ...TS_TARGETS];

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

/** Replace the FIRST `VERSION = '...'` / `VERSION = "..."` literal in a TS module. */
export function bumpTsVersion(tsText, version) {
  const re = /(VERSION\s*=\s*['"])[^'"]*(['"])/;
  if (!re.test(tsText)) throw new Error("no VERSION constant found");
  return tsText.replace(re, `$1${version}$2`);
}

/** Bump any target's text, choosing JSON vs TOML vs TS by file extension. */
export function bumpVersion(path, text, version) {
  if (path.endsWith(".toml")) return bumpTomlVersion(text, version);
  if (path.endsWith(".ts")) return bumpTsVersion(text, version);
  return bumpJsonVersion(text, version);
}

/** Read the version out of any target file's text. */
export function readVersion(path, text) {
  if (path.endsWith(".toml")) {
    const m = text.match(/^version\s*=\s*"([^"]*)"/m);
    if (!m) throw new Error(`no version in ${path}`);
    return m[1];
  }
  if (path.endsWith(".ts")) {
    const m = text.match(/VERSION\s*=\s*['"]([^'"]*)['"]/);
    if (!m) throw new Error(`no VERSION in ${path}`);
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
