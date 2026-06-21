// packages/cli/test/agent/services/mcp-server.test.ts
import { describe, it, expect } from 'vitest';
import { makeServiceTools } from '../../../src/agent/services/mcp-server.ts';
import type { ManifestEntry } from '../../../src/services/manifest.ts';

const entries: ManifestEntry[] = [{
  id: 'docker:pw-db:5432', label: 'Postgres (pw-db)', kind: 'docker', host: '127.0.0.1',
  remotePort: 5432, localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432', mirrored: true, status: 'active',
}];

describe('makeServiceTools', () => {
  it('list_services returns the manifest entries', async () => {
    const tools = makeServiceTools(() => entries);
    const r = await tools.list_services();
    expect(r.services[0]).toMatchObject({ id: 'docker:pw-db:5432', remotePort: 5432 });
  });

  it('get_connection returns the hint for a known id', async () => {
    const tools = makeServiceTools(() => entries);
    expect(await tools.get_connection({ id: 'docker:pw-db:5432' })).toEqual({ ok: true, connectionHint: 'postgres://127.0.0.1:5432', remotePort: 5432 });
  });

  it('get_connection reports not-found for an unknown id', async () => {
    const tools = makeServiceTools(() => entries);
    expect(await tools.get_connection({ id: 'nope' })).toEqual({ ok: false, error: 'no service with id nope' });
  });
});
