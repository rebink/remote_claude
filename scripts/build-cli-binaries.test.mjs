import { describe, it, expect } from 'vitest';
import { TARGETS } from './build-cli-binaries.mjs';

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
