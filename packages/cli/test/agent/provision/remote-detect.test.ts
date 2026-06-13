import { describe, it, expect } from 'vitest';
import { buildProbeScript, parseProbe, PROBE_TOOLS } from '../../../src/agent/provision/remote-detect.ts';

describe('buildProbeScript', () => {
  it('emits a uname line then a command -v loop over the probe tools', () => {
    const s = buildProbeScript();
    expect(s).toMatch(/^uname -sm;/);
    expect(s).toContain('for c in node corepack pnpm');
    expect(s).toContain('command -v "$c"');
    for (const t of PROBE_TOOLS) expect(s).toContain(t);
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
