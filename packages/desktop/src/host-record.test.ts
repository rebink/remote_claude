import { describe, it, expect } from 'vitest';
import { buildHostRecord } from './host-record.ts';
describe('buildHostRecord', () => {
  it('builds a secret-free record from args + result', () => {
    const rec = buildHostRecord(
      { host: '10.0.0.2', user: 'admin', port: 22, keyPath: '~/.ssh/k', agentPort: 7878, token: 'SECRET' },
      { status: 'completed', health: { tailnet: false, agent: 'healthy' } },
      'fixed-id', '2026-06-14T00:00:00Z',
    );
    expect(rec).toEqual({
      id: 'fixed-id', label: 'admin@10.0.0.2', host: '10.0.0.2', user: 'admin',
      port: 22, keyPath: '~/.ssh/k', agentPort: 7878,
      lastStatus: 'completed', lastHealth: 'healthy', lastProvisionedAt: '2026-06-14T00:00:00Z',
    });
    expect(JSON.stringify(rec)).not.toContain('SECRET');
  });
});
