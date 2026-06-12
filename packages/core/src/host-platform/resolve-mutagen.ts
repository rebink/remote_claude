import { join } from 'node:path';
import type { ResolveMutagenDeps, MutagenManifest, OsArch } from './types.ts';
import { archiveFormat } from './archive.ts';

export function mutagenBinName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'mutagen.exe' : 'mutagen';
}

export function cachedMutagenPath(homeDir: string, platform: NodeJS.Platform): string {
  return join(homeDir, '.patchwire', 'bin', mutagenBinName(platform));
}

/** Map Node platform+arch to a manifest key, or null if unsupported. */
export function osArchKey(platform: NodeJS.Platform, arch: string): OsArch | null {
  const p = platform === 'darwin' || platform === 'linux' || platform === 'win32' ? platform : null;
  const a = arch === 'x64' || arch === 'arm64' ? arch : null;
  if (!p || !a) return null;
  return `${p}-${a}` as OsArch;
}

export async function resolveMutagen(
  deps: ResolveMutagenDeps,
  manifest: MutagenManifest,
): Promise<string> {
  const onPath = deps.which('mutagen');
  if (onPath) return onPath;

  const bundled = deps.bundledPath();
  if (bundled) return bundled;

  const cached = cachedMutagenPath(deps.homeDir, deps.platform);
  if (deps.fileExists(cached)) return cached;

  const key = osArchKey(deps.platform, deps.arch);
  const entry = key ? manifest[key] : undefined;
  if (!key || !entry) {
    throw new Error(`no mutagen build for ${key ?? `${deps.platform}-${deps.arch}`}`);
  }

  const bytes = await deps.download(entry.url);
  const got = deps.sha256(bytes);
  if (got !== entry.sha256) {
    throw new Error(`mutagen checksum mismatch: expected ${entry.sha256}, got ${got}`);
  }
  const fmt = archiveFormat(entry.url);
  const binary =
    fmt === 'raw' ? bytes : deps.extractArchive(bytes, entry.archiveBinaryPath ?? '', fmt);
  deps.writeExecutable(cached, binary);
  return cached;
}
