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

describe('detectServerPlatform — Linux', () => {
  it('maps nftables egress (needs elevation), systemd, apt, bash', () => {
    const d = detectServerPlatform(deps('linux', 'x64', ['nft', 'systemctl', 'apt-get']));
    expect(d.os).toBe('linux');
    expect(d.pathStyle).toBe('posix');
    expect(d.capabilities.egress).toEqual({ type: 'nftables', requiresElevation: true });
    expect(d.capabilities.filesystemIsolation.type).toBe('none'); // namespaces deferred to S2
    expect(d.capabilities.service.type).toBe('systemd-user');
    expect(d.capabilities.packageManager).toEqual({ type: 'apt', requiresElevation: true });
    expect(d.capabilities.secrets.type).toBe('file');
    expect(d.capabilities.shell.type).toBe('bash');
  });
  it('uses libsecret when secret-tool is present', () => {
    const d = detectServerPlatform(deps('linux', 'x64', ['secret-tool']));
    expect(d.capabilities.secrets.type).toBe('libsecret');
  });
});

describe('detectServerPlatform — Windows', () => {
  it('maps win path style, pwsh, dpapi, windows-service, winget', () => {
    const d = detectServerPlatform(deps('win32', 'x64', ['sc', 'winget']));
    expect(d.os).toBe('windows');
    expect(d.pathStyle).toBe('win');
    expect(d.capabilities.shell.type).toBe('pwsh');
    expect(d.capabilities.secrets.type).toBe('dpapi');
    expect(d.capabilities.service).toEqual({ type: 'windows-service', requiresElevation: true });
    expect(d.capabilities.packageManager.type).toBe('winget');
    expect(d.capabilities.egress.type).toBe('none'); // WFP impl deferred to S3
    expect(d.capabilities.filesystemIsolation.type).toBe('none');
  });
});
