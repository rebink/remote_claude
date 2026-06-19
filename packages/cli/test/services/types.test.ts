// packages/cli/test/services/types.test.ts
import { describe, it, expect } from 'vitest';
import type { DiscoveredService, Projection, SshTarget, Discoverer, Transport } from '../../src/services/types.ts';

describe('service types', () => {
  it('a Projection composes a DiscoveredService with remote binding info', () => {
    const svc: DiscoveredService = {
      id: 'docker:5432', label: 'Postgres', kind: 'docker', localPort: 5432,
      connectionHint: 'postgres://127.0.0.1:5432',
    };
    const p: Projection = { service: svc, remotePort: 5432, mirrored: true, status: 'active' };
    expect(p.service.localPort).toBe(5432);
    expect(p.mirrored).toBe(true);
  });

  it('SshTarget / Discoverer / Transport are usable shapes', () => {
    const t: SshTarget = { host: 'h', user: 'u', port: 22, keyPath: '/k' };
    const d: Discoverer = { discover: async () => [] };
    const tr: Transport = { open: () => ({ stop() {} }) };
    expect(t.port).toBe(22);
    expect(tr.open({ localPort: 1, remotePort: 1 }, () => {})).toBeTruthy();
    return d.discover();
  });
});
