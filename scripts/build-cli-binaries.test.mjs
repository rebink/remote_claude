import { describe, it, expect } from 'vitest';
import { TARGETS, selectTargets } from './build-cli-binaries.mjs';

describe('CLI binary targets', () => {
  it('covers the 5 supported os/arch with bun targets + asset names', () => {
    const byKey = Object.fromEntries(TARGETS.map((t) => [t.key, t]));
    expect(byKey['darwin-arm64']).toMatchObject({ target: 'bun-darwin-arm64', asset: 'patchwire-cli-darwin-arm64' });
    expect(byKey['linux-x64']).toMatchObject({ target: 'bun-linux-x64', asset: 'patchwire-cli-linux-x64' });
    expect(byKey['windows-x64']).toMatchObject({ target: 'bun-windows-x64', asset: 'patchwire-cli-windows-x64.exe' });
  });
  it('windows asset has .exe, posix assets do not', () => {
    for (const t of TARGETS) {
      if (t.key.startsWith('windows')) expect(t.asset.endsWith('.exe')).toBe(true);
      else expect(t.asset.endsWith('.exe')).toBe(false);
    }
  });
});

describe('selectTargets', () => {
  it('no filter → all targets', () => {
    expect(selectTargets(null)).toHaveLength(TARGETS.length);
  });
  it('--only builds just the named native target', () => {
    expect(selectTargets('bun-windows-x64').map((t) => t.target)).toEqual(['bun-windows-x64']);
  });
  it('unknown target throws', () => {
    expect(() => selectTargets('bun-solaris')).toThrow(/unknown --only target/);
  });
});
