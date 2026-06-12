import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, delimiter, join } from 'node:path';
import type { ResolveMutagenDeps } from './types.ts';
import { extractMutagenBinary } from './archive.ts';

/** Look up `cmd` on PATH without shelling out to which/where. */
function whichOnPath(cmd: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function nodeResolveMutagenDeps(opts: {
  bundledPath: () => string | null;
  download?: (url: string) => Promise<Buffer>;
}): ResolveMutagenDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    homeDir: homedir(),
    which: whichOnPath,
    bundledPath: opts.bundledPath,
    fileExists: (p) => existsSync(p),
    download:
      opts.download ??
      (async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
        return Buffer.from(await res.arrayBuffer());
      }),
    sha256: (buf) => createHash('sha256').update(new Uint8Array(buf)).digest('hex'),
    writeExecutable: (p, buf) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, new Uint8Array(buf), { mode: 0o755 });
    },
    extractArchive: (bytes, path, format) => extractMutagenBinary(bytes, path, format),
  };
}
