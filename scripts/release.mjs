// scripts/release.mjs
// One-command unified release.
//   node scripts/release.mjs <X.Y.Z>            bump ALL targets, commit, tag, push (CI fires)
//   node scripts/release.mjs --dry-run <X.Y.Z>  print the planned bumps, write/commit/push nothing
//   node scripts/release.mjs --check <ref>       assert tag == every target version (CI guard)
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { TARGETS, isSemver, bumpVersion, readVersion, readAllVersions, checkVersions } from "./release-version.mjs";

const read = (p) => readFileSync(p, "utf8");
const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const args = process.argv.slice(2);

// --check <ref> — CI guard
if (args[0] === "--check") {
  const ref = args[1];
  if (!ref) die("usage: release.mjs --check <ref>");
  const r = checkVersions(ref, readAllVersions(read));
  if (!r.ok) die(r.reason);
  console.log(`✓ ${ref} matches all ${TARGETS.length} targets at ${r.version}`);
  process.exit(0);
}

// --dry-run <X.Y.Z>
const dryRun = args[0] === "--dry-run";
const version = dryRun ? args[1] : args[0];
if (!version || !isSemver(version)) die(`expected a semver version, e.g. 0.5.0 (got: ${version ?? "<none>"})`);
const tag = `v${version}`;

if (dryRun) {
  for (const path of TARGETS) {
    console.log(`${path}: ${readVersion(path, read(path))} -> ${version}`);
  }
  console.log(`(dry run) would commit, tag ${tag}, push origin main + ${tag}`);
  process.exit(0);
}

// Live release — preflight guards (auto-push is irreversible)
if (sh("git status --porcelain")) die("working tree is dirty — commit or stash first");
const branch = sh("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") die(`releases must be cut from main (on ${branch})`);
try { sh(`git rev-parse -q --verify refs/tags/${tag}`); die(`tag ${tag} already exists`); } catch { /* good: tag missing */ }

for (const path of TARGETS) {
  writeFileSync(path, bumpVersion(path, read(path), version));
}
sh(`git add ${TARGETS.join(" ")}`);
sh(`git commit -m "chore(release): ${tag}"`);
sh(`git tag ${tag}`);
sh("git push origin main");
sh(`git push origin ${tag}`);

console.log(`✓ released ${tag}: bumped ${TARGETS.length} files, committed, tagged, pushed`);
console.log("→ watch CI: https://github.com/rebink/remote_claude/actions");
