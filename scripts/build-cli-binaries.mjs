#!/usr/bin/env node
// Bun-compile the patchwire CLI to standalone per-OS binaries for the desktop sidecar.
// Mirrors build-agent-binaries.mjs but compiles cli.ts and names outputs patchwire-cli-<os>-<arch>.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @type {Array<{ target: string; asset: string; key: string }>} */
export const TARGETS = [
  { target: 'bun-darwin-arm64', asset: 'patchwire-cli-darwin-arm64',     key: 'darwin-arm64' },
  { target: 'bun-darwin-x64',   asset: 'patchwire-cli-darwin-x64',       key: 'darwin-x64'   },
  { target: 'bun-linux-arm64',  asset: 'patchwire-cli-linux-arm64',      key: 'linux-arm64'  },
  { target: 'bun-linux-x64',    asset: 'patchwire-cli-linux-x64',        key: 'linux-x64'    },
  { target: 'bun-windows-x64',  asset: 'patchwire-cli-windows-x64.exe',  key: 'windows-x64'  },
];

// CLI entry point + output dir, relative to repo root (this file is in scripts/).
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'packages', 'cli', 'src', 'cli.ts');
const outDir = join(root, 'dist-cli-bin');

function main() {
  mkdirSync(outDir, { recursive: true });
  const built = [];
  for (const { target, asset, key } of TARGETS) {
    const outfile = join(outDir, asset);
    console.log(`Building ${asset} (${target}) …`);
    const r = spawnSync('bun', ['build', '--compile', `--target=${target}`, '--outfile', outfile, entry], { stdio: 'inherit' });
    if (r.status !== 0) { console.error(`bun build failed for ${target}`); process.exit(1); }
    built.push({ key, asset, bytes: readFileSync(outfile).length });
  }
  const version = JSON.parse(readFileSync(join(root, 'packages', 'cli', 'package.json'), 'utf8')).version;
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ version, binaries: built }, null, 2) + '\n');
  console.log(`Wrote dist-cli-bin/manifest.json (version ${version}, ${TARGETS.length} CLI binaries)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
