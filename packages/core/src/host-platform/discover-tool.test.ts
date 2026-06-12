import { describe, it, expect } from 'vitest';
import { toolCandidates } from './discover-tool.ts';

describe('toolCandidates', () => {
  it('uses PATH dirs with .exe on win32 and includes Tailscale install dir', () => {
    const c = toolCandidates('win32', 'tailscale', { PATH: 'C:\\bin;C:\\tools' });
    expect(c).toContain('C:\\bin\\tailscale.exe');
    expect(c.some((p) => p.includes('Program Files') && p.endsWith('tailscale.exe'))).toBe(true);
  });
  it('uses bare name on non-win32 and known darwin locations', () => {
    const c = toolCandidates('darwin', 'tailscale', { PATH: '/usr/bin' });
    expect(c).toContain('/usr/bin/tailscale');
    expect(c).toContain('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
  });
  it('returns only PATH candidates for an unknown tool', () => {
    const c = toolCandidates('linux', 'sometool', { PATH: '/usr/bin' });
    expect(c).toEqual(['/usr/bin/sometool']);
  });
});
