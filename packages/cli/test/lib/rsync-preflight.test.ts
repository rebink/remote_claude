import { describe, it, expect } from 'vitest';
import { rsyncPreflight } from '../../src/lib/rsync-preflight.ts';

describe('rsyncPreflight', () => {
  it('blocks win32 with a message pointing to the extension', () => {
    const r = rsyncPreflight('win32', true);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Windows/);
    expect(r.message).toMatch(/extension/i);
  });
  it('blocks when rsync is missing on a unix platform', () => {
    const r = rsyncPreflight('linux', false);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/rsync was not found/i);
  });
  it('allows when on unix with rsync present', () => {
    expect(rsyncPreflight('darwin', true)).toEqual({ ok: true });
  });
});
