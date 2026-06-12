import { describe, it, expect } from 'vitest';
import { detectServerPlatform } from '../../../src/agent/server-platform/detect.ts';
import type { DetectDeps } from '../../../src/agent/server-platform/types.ts';

function deps(platform: NodeJS.Platform, arch: string, present: string[]): DetectDeps {
  const set = new Set(present);
  return { platform, arch, has: (c) => set.has(c) };
}

describe('detectServerPlatform — macOS', () => {
  it('maps a full macOS host to real capabilities', () => {
    const d = detectServerPlatform(deps('darwin', 'arm64', ['sandbox-exec', 'launchctl', 'brew', 'zsh']));
    expect(d.os).toBe('macos');
    expect(d.arch).toBe('arm64');
    expect(d.pathStyle).toBe('posix');
    expect(d.capabilities.egress).toEqual({ type: 'seatbelt', requiresElevation: false });
    expect(d.capabilities.filesystemIsolation).toEqual({ type: 'seatbelt', requiresElevation: false });
    expect(d.capabilities.secrets.type).toBe('keychain');
    expect(d.capabilities.service.type).toBe('launchd');
    expect(d.capabilities.shell.type).toBe('zsh');
    expect(d.capabilities.packageManager.type).toBe('brew');
  });

  it('reports egress + filesystemIsolation as none when sandbox-exec is absent (fail-closed signal)', () => {
    const d = detectServerPlatform(deps('darwin', 'x64', ['launchctl']));
    expect(d.capabilities.egress.type).toBe('none');
    expect(d.capabilities.filesystemIsolation.type).toBe('none');
  });
});
