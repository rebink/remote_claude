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
