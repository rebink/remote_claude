import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { detectServerPlatform } from './detect.ts';
import type { DetectDeps, DetectedServerPlatform } from './types.ts';

/** True if `cmd` is on PATH (no subprocess spawned). */
function onPath(cmd: string): boolean {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) if (existsSync(join(dir, cmd + ext))) return true;
  }
  return false;
}

export function nodeDetectDeps(): DetectDeps {
  return { platform: process.platform, arch: process.arch, has: onPath };
}

/** Detect this host's ServerPlatform using real PATH probing. */
export function detectNodeServerPlatform(): DetectedServerPlatform {
  return detectServerPlatform(nodeDetectDeps());
}
