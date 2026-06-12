import type { ResolveMutagenDeps, MutagenManifest } from './types.ts';

/** Binary filename for a platform (.exe on Windows). */
export function mutagenBinName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'mutagen.exe' : 'mutagen';
}

/**
 * Resolve an absolute path to a Mutagen binary: PATH → bundled → cached → download.
 * Only the PATH tier is implemented in this task; later tiers are added next.
 */
export async function resolveMutagen(
  deps: ResolveMutagenDeps,
  _manifest: MutagenManifest,
): Promise<string> {
  const onPath = deps.which('mutagen');
  if (onPath) return onPath;

  throw new Error('mutagen could not be resolved');
}
