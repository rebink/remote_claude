import { join } from 'node:path';
import type { ResolveMutagenDeps, MutagenManifest } from './types.ts';

export function mutagenBinName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'mutagen.exe' : 'mutagen';
}

/** Absolute path of the cached binary under ~/.patchwire/bin. */
export function cachedMutagenPath(homeDir: string, platform: NodeJS.Platform): string {
  return join(homeDir, '.patchwire', 'bin', mutagenBinName(platform));
}

export async function resolveMutagen(
  deps: ResolveMutagenDeps,
  _manifest: MutagenManifest,
): Promise<string> {
  const onPath = deps.which('mutagen');
  if (onPath) return onPath;

  const bundled = deps.bundledPath();
  if (bundled) return bundled;

  const cached = cachedMutagenPath(deps.homeDir, deps.platform);
  if (deps.fileExists(cached)) return cached;

  throw new Error('mutagen could not be resolved');
}
