// scripts/release-desktop.mjs
// One-command desktop release helper.
//   node scripts/release-desktop.mjs <X.Y.Z>        bump pkg+conf, commit, tag, print push cmd
//   node scripts/release-desktop.mjs --check <ref>  assert tag version == pkg == conf (CI guard)
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  PKG_PATH, CONF_PATH, isSemver, versionFromTag, bumpJsonVersion,
  readDesktopVersions, checkVersions,
} from "./desktop-release-version.mjs";

const read = (p) => readFileSync(p, "utf8");
const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const args = process.argv.slice(2);

if (args[0] === "--check") {
  const ref = args[1];
  if (!ref) die("usage: release-desktop.mjs --check <ref>");
  const { pkg, conf } = readDesktopVersions(read);
  const r = checkVersions(ref, pkg, conf);
  if (!r.ok) die(r.reason);
  console.log(`✓ ${ref} matches desktop version ${r.version}`);
  process.exit(0);
}

// Bump mode
const version = args[0];
if (!version || !isSemver(version)) die(`expected a semver version, e.g. 0.5.0 (got: ${version ?? "<none>"})`);
const tag = `desktop-v${version}`;

if (sh("git status --porcelain")) die("working tree is dirty — commit or stash first");
try { sh(`git rev-parse -q --verify refs/tags/${tag}`); die(`tag ${tag} already exists`); } catch { /* good: tag missing */ }

for (const path of [PKG_PATH, CONF_PATH]) {
  writeFileSync(path, bumpJsonVersion(read(path), version));
}
sh(`git add ${PKG_PATH} ${CONF_PATH}`);
sh(`git commit -m "chore(desktop): release v${version}"`);
sh(`git tag ${tag}`);

console.log(`✓ bumped to ${version}, committed, tagged ${tag}`);
console.log(`→ push the tag to release:  git push origin ${tag}`);
