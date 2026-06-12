import { spawnSync } from 'node:child_process';

export interface RsyncPreflight {
  ok: boolean;
  message?: string;
}

/** Pure: decide whether rsync-based CLI sync can run on this platform. */
export function rsyncPreflight(platform: NodeJS.Platform, hasRsync: boolean): RsyncPreflight {
  if (platform === 'win32') {
    return {
      ok: false,
      message:
        'Patchwire CLI sync uses rsync, which is not available on Windows. ' +
        'Use the Patchwire VS Code extension (it syncs via Mutagen), or run the CLI under WSL.',
    };
  }
  if (!hasRsync) {
    return {
      ok: false,
      message:
        'rsync was not found on PATH. Install it (Debian/Ubuntu: `sudo apt install rsync`; ' +
        'macOS ships it by default) and re-run.',
    };
  }
  return { ok: true };
}

/** True if an `rsync` binary is runnable on PATH. */
export function hasRsyncBinary(): boolean {
  return spawnSync('rsync', ['--version'], { stdio: 'ignore' }).status === 0;
}

/** Throw a clear, actionable error if rsync-based sync cannot run here. */
export function assertRsyncAvailable(): void {
  const pf = rsyncPreflight(process.platform, hasRsyncBinary());
  if (!pf.ok) throw new Error(pf.message);
}
