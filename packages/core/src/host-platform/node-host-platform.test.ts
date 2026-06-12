import { describe, it, expect } from 'vitest';
import { createNodeHostPlatform } from './node-host-platform.ts';

describe('createNodeHostPlatform', () => {
  it('exposes the full HostPlatform surface', () => {
    const hp = createNodeHostPlatform();
    expect(typeof hp.resolveMutagen).toBe('function');
    expect(typeof hp.discoverTool).toBe('function');
    expect(typeof hp.captureClipboardImage).toBe('function');
    expect(hp.normalizePatch('a\r\nb')).toBe('a\nb');
  });
  it('discoverTool returns null for a tool that does not exist', async () => {
    const hp = createNodeHostPlatform();
    expect(await hp.discoverTool('definitely-not-real-xyz')).toBeNull();
  });
});
