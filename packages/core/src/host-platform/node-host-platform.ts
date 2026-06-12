import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostPlatform, MutagenManifest } from './types.ts';
import { resolveMutagen } from './resolve-mutagen.ts';
import { nodeResolveMutagenDeps } from './node-deps.ts';
import { normalizePatch } from './patch.ts';
import { toolCandidates } from './discover-tool.ts';
import { clipboardImageCommands } from './clipboard.ts';
import manifest from './mutagen-manifest.json';

/** Build the Node-backed HostPlatform used by the CLI and extension. */
export function createNodeHostPlatform(opts?: { bundledMutagenPath?: () => string | null }): HostPlatform {
  return {
    resolveMutagen: () =>
      resolveMutagen(
        nodeResolveMutagenDeps({ bundledPath: opts?.bundledMutagenPath ?? (() => null) }),
        manifest as MutagenManifest,
      ),

    normalizePatch,

    discoverTool: async (name) => {
      for (const candidate of toolCandidates(process.platform, name, process.env)) {
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },

    captureClipboardImage: async () => {
      const out = join(mkdtempSync(join(tmpdir(), 'pw-clip-')), 'clip.png');
      for (const c of clipboardImageCommands(process.platform, out)) {
        if (c.writesToStdout) {
          const r = spawnSync(c.cmd, c.args, { maxBuffer: 64 * 1024 * 1024 });
          if (r.status === 0 && r.stdout && r.stdout.length > 0) {
            writeFileSync(out, new Uint8Array(r.stdout));
            return out;
          }
        } else {
          const r = spawnSync(c.cmd, c.args, { stdio: 'ignore' });
          if (r.status === 0 && existsSync(out)) return out;
        }
      }
      return null;
    },
  };
}
