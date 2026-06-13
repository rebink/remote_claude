// Asset naming is the contract shared with packages/cli/src/agent/provision/release-binary-source.ts (assetName()).
// Keep the target table and asset names below in sync with that function.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const { version } = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));

/** @type {Array<{ target: string; asset: string; key: string }>} */
const targets = [
  { target: 'bun-darwin-x64',   asset: 'patchwire-agent-darwin-x64',        key: 'darwin-x64'  },
  { target: 'bun-darwin-arm64',  asset: 'patchwire-agent-darwin-arm64',       key: 'darwin-arm64' },
  { target: 'bun-linux-x64',    asset: 'patchwire-agent-linux-x64',          key: 'linux-x64'   },
  { target: 'bun-linux-arm64',   asset: 'patchwire-agent-linux-arm64',         key: 'linux-arm64'  },
  { target: 'bun-windows-x64',  asset: 'patchwire-agent-windows-x64.exe',    key: 'windows-x64' },
  // bun-windows-arm64 omitted — limited Bun support for Windows ARM64; TODO when Bun adds stable support
];

const distBin = join(root, 'dist-bin');
mkdirSync(distBin, { recursive: true });

/** @type {Record<string, { file: string; sha256: string }>} */
const binaries = {};

for (const { target, asset, key } of targets) {
  const outfile = join(distBin, asset);
  console.log(`Building ${asset} (${target}) …`);
  execFileSync(
    'bun',
    ['build', '--compile', `--target=${target}`, '--outfile', outfile, 'packages/cli/src/agent.ts'],
    { stdio: 'inherit', cwd: root },
  );
  const bytes = readFileSync(outfile);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  binaries[key] = { file: asset, sha256 };
  console.log(`  sha256: ${sha256}  →  dist-bin/${asset}`);
}

const manifest = { version, binaries };
writeFileSync(join(distBin, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote dist-bin/manifest.json (version ${version}, ${targets.length} binaries)`);
