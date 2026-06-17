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
