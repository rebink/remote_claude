import { describe, it, expect } from 'vitest';
import { makeVerify } from '../../../src/agent/provision/verify.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };
const DETECTED = { os: 'macos', arch: 'arm64', pathStyle: 'posix' } as unknown as DetectedServerPlatform;

describe('makeVerify', () => {
  it('reports tailnet up + agent healthy', async () => {
    const verify = makeVerify(CONN, {
      runner: async () => ({ stdout: '', stderr: '', code: 0 }),
      agentHealth: async () => ({ ok: true }),
    });
    expect(await verify(CONN, DETECTED)).toEqual({ tailnet: true, agent: 'healthy', detail: undefined });
  });

  it('reports tailnet down when tailscale status is non-zero', async () => {
    const verify = makeVerify(CONN, {
      runner: async () => ({ stdout: '', stderr: '', code: 1 }),
      agentHealth: async () => ({ ok: true }),
    });
    const r = await verify(CONN, DETECTED);
    expect(r.tailnet).toBe(false);
    expect(r.agent).toBe('healthy');
  });

  it('marks agent unhealthy when /health reports not-ok', async () => {
    const verify = makeVerify(CONN, {
      runner: async () => ({ stdout: '', stderr: '', code: 0 }),
      agentHealth: async () => ({ ok: false, detail: 'claude not found' }),
    });
    const r = await verify(CONN, DETECTED);
    expect(r.agent).toBe('unhealthy');
    expect(r.detail).toBe('claude not found');
  });

  it('captures a thrown agentHealth as unhealthy (never throws — verify is non-fatal)', async () => {
    const verify = makeVerify(CONN, {
      runner: async () => ({ stdout: '', stderr: '', code: 0 }),
      agentHealth: async () => { throw new Error('connection refused'); },
    });
    const r = await verify(CONN, DETECTED);
    expect(r.agent).toBe('unhealthy');
    expect(r.detail).toMatch(/connection refused/);
  });
});
