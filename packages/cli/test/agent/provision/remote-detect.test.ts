import { describe, it, expect } from 'vitest';
import { buildProbeScript, parseProbe, PROBE_TOOLS, detectRemoteServerPlatform, buildWindowsProbeScript, parseWindowsProbe, WINDOWS_PROBE_TOOLS } from '../../../src/agent/provision/remote-detect.ts';
import { POSIX_PATH_PREFIX } from '../../../src/agent/provision/primitives.ts';

describe('buildProbeScript', () => {
  it('emits a uname line then a command -v loop over the probe tools', () => {
    const s = buildProbeScript();
    expect(s).toContain('uname -sm;');
    expect(s).toContain('for c in node corepack pnpm');
    expect(s).toContain('command -v "$c"');
    for (const t of PROBE_TOOLS) expect(s).toContain(t);
  });

  it('prepends the POSIX PATH prefix so Homebrew tools are found in non-interactive SSH sessions', () => {
    const s = buildProbeScript();
    // The prefix must appear before uname so the PATH is set for the entire script
    expect(s).toContain(POSIX_PATH_PREFIX);
    expect(s.indexOf(POSIX_PATH_PREFIX)).toBeLessThan(s.indexOf('uname -sm'));
    // The prefix must contain /opt/homebrew/bin (for macOS Homebrew tools)
    expect(s).toContain('/opt/homebrew/bin');
    // $PATH must be preserved — not replaced
    expect(s).toContain('$PATH"');
  });

  it('probe script does not contain ";;" (which would be a case-terminator parse error)', () => {
    const s = buildProbeScript();
    expect(s).not.toContain(';;');
  });

  it('does not modify the Windows probe script (buildWindowsProbeScript)', () => {
    const w = buildWindowsProbeScript();
    expect(w).not.toContain('/opt/homebrew/bin');
    expect(w).not.toContain(POSIX_PATH_PREFIX);
  });
});

describe('parseProbe', () => {
  it('parses a macOS arm64 probe with present tools', () => {
    const deps = parseProbe('Darwin arm64\nhas:node\nhas:launchctl\nhas:zsh\nhas:brew');
    expect(deps).not.toBeNull();
    expect(deps!.platform).toBe('darwin');
    expect(deps!.arch).toBe('arm64');
    expect(deps!.has('launchctl')).toBe(true);
    expect(deps!.has('nft')).toBe(false);
  });

  it('maps Linux x86_64 → linux/x64 and aarch64 → arm64', () => {
    expect(parseProbe('Linux x86_64\nhas:systemctl')!.platform).toBe('linux');
    expect(parseProbe('Linux x86_64')!.arch).toBe('x64');
    expect(parseProbe('Linux aarch64')!.arch).toBe('arm64');
  });

  it('is Node-independent: absence of has:node is not a parse failure', () => {
    const deps = parseProbe('Darwin arm64\nhas:zsh');
    expect(deps).not.toBeNull();
    expect(deps!.has('node')).toBe(false);
  });

  it('returns null when the first line is not a recognized uname (e.g. Windows shell)', () => {
    expect(parseProbe("'uname' is not recognized as a command")).toBeNull();
    expect(parseProbe('')).toBeNull();
  });
});

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

describe('buildWindowsProbeScript', () => {
  it('contains the expected PowerShell invocation and all probe tools', () => {
    const s = buildWindowsProbeScript();
    expect(s).toContain('powershell -NoProfile -Command');
    expect(s).toContain('OSArchitecture');
    expect(s).toContain('Get-Command');
    for (const t of WINDOWS_PROBE_TOOLS) expect(s).toContain(t);
  });
});

describe('parseWindowsProbe', () => {
  it('parses WINDOWS X64 with present tools', () => {
    const deps = parseWindowsProbe('WINDOWS X64\r\nhas:node\r\nhas:winget');
    expect(deps).not.toBeNull();
    expect(deps!.platform).toBe('win32');
    expect(deps!.arch).toBe('x64');
    expect(deps!.has('winget')).toBe(true);
    expect(deps!.has('sc')).toBe(false);
  });

  it('maps Arm64 → arm64', () => {
    const deps = parseWindowsProbe('WINDOWS Arm64');
    expect(deps).not.toBeNull();
    expect(deps!.arch).toBe('arm64');
  });

  it('returns null for a non-WINDOWS first line', () => {
    expect(parseWindowsProbe('Darwin arm64')).toBeNull();
    expect(parseWindowsProbe('')).toBeNull();
  });
});

describe('detectRemoteServerPlatform', () => {
  it('runs the probe and maps a macOS host to real capabilities', async () => {
    const runner = async () => ({ stdout: 'Darwin arm64\nhas:sandbox-exec\nhas:launchctl\nhas:zsh\nhas:brew\nhas:node', code: 0 });
    const d = await detectRemoteServerPlatform(CONN, runner);
    expect(d.os).toBe('macos');
    expect(d.arch).toBe('arm64');
    expect(d.capabilities.egress.type).toBe('seatbelt');
    expect(d.capabilities.service.type).toBe('launchd');
  });

  it('is Node-independent: a host with no node still detects fine', async () => {
    const runner = async () => ({ stdout: 'Linux x86_64\nhas:systemctl\nhas:apt-get', code: 0 });
    const d = await detectRemoteServerPlatform(CONN, runner);
    expect(d.os).toBe('linux');
    expect(d.capabilities.service.type).toBe('systemd-user');
    // (the caller treats missing node as a plan-time prerequisite, not a detection error)
  });

  it('falls back to the Windows PowerShell probe when the POSIX probe is unrecognized', async () => {
    const runner = async (script: string) =>
      script.includes('powershell')
        ? { stdout: 'WINDOWS X64\r\nhas:sc\r\nhas:winget\r\nhas:node', code: 0 }
        : { stdout: "'uname' is not recognized", code: 1 };
    const d = await detectRemoteServerPlatform(CONN, runner);
    expect(d.os).toBe('windows');
    expect(d.arch).toBe('x64');
    expect(d.capabilities.service.type).toBe('schtasks');
    expect(d.capabilities.secrets.type).toBe('dpapi');
  });

  it('throws an actionable error when neither POSIX nor Windows probe is recognized', async () => {
    const runner = async () => ({ stdout: 'garbage output', code: 1 });
    await expect(detectRemoteServerPlatform(CONN, runner)).rejects.toThrow(/Could not detect the remote OS/);
  });
});
