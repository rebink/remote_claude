#!/usr/bin/env node
// Stage the `patchwire` CLI as a Tauri sidecar named `patchwire-<TARGET_TRIPLE>`.
//   dev (default): wrapper that execs `node <repo>/packages/cli/dist/cli.js "$@"`
//   --from-release <dir>: copy bun binaries, renaming bun targets -> Tauri triples
import { execSync } from 'node:child_process';
import { writeFileSync, chmodSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const BUN_TO_TRIPLE = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'windows-x64': 'x86_64-pc-windows-msvc',
};
export function bunTargetToTriple(name) {
  const key = Object.keys(BUN_TO_TRIPLE).find((k) => name.includes(k));
  if (!key) throw new Error(`unknown bun target: ${name}`);
  return BUN_TO_TRIPLE[key];
}
export function hostTriple() { return execSync('rustc --print host-tuple').toString().trim(); }
function binariesDir() { const here = dirname(fileURLToPath(import.meta.url)); return join(here, '..', 'src-tauri', 'binaries'); }
function stageDevWrapper() {
  const triple = hostTriple();
  if (triple.includes('windows')) throw new Error('dev wrapper is POSIX-only; use --from-release on Windows');
  const here = dirname(fileURLToPath(import.meta.url));
  const cliJs = join(here, '..', '..', 'cli', 'dist', 'cli.js');
  const out = join(binariesDir(), `patchwire-${triple}`);
  mkdirSync(binariesDir(), { recursive: true });
  writeFileSync(out, `#!/bin/sh\nexec node "${cliJs}" "$@"\n`);
  chmodSync(out, 0o755);
  console.log(`staged dev sidecar: ${out} -> node ${cliJs}`);
}
function stageFromRelease(dir) {
  mkdirSync(binariesDir(), { recursive: true });
  for (const f of readdirSync(dir)) {
    let triple; try { triple = bunTargetToTriple(f); } catch { continue; }
    const ext = triple.includes('windows') ? '.exe' : '';
    const dest = join(binariesDir(), `patchwire-${triple}${ext}`);
    copyFileSync(join(dir, f), dest);
    if (!ext) chmodSync(dest, 0o755);
    console.log(`staged ${f} -> ${dest}`);
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--from-release');
  if (i !== -1) stageFromRelease(process.argv[i + 1]); else stageDevWrapper();
}
