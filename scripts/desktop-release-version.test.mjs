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
  assert.match(out, /"@tauri-apps\/api": "\^2"/);
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
