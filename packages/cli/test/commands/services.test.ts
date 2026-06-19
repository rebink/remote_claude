// packages/cli/test/commands/services.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateDiscovered, renderStatus } from '../../src/commands/services.ts';
import type { DiscoveredService, Projection } from '../../src/services/types.ts';

const a: DiscoveredService = { id: 'docker:pw-db:5432', label: 'Postgres', kind: 'docker', localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432' };
const b: DiscoveredService = { id: 'dart-vm:50123', label: 'Dart VM Service :50123', kind: 'dart-vm', localPort: 50123, connectionHint: 'http://127.0.0.1:50123' };

describe('aggregateDiscovered', () => {
  it('merges discoverer outputs and de-dupes by id', () => {
    const out = aggregateDiscovered([[a, b], [a]]);
    expect(out.map((s) => s.id).sort()).toEqual(['dart-vm:50123', 'docker:pw-db:5432']);
  });
});

describe('renderStatus', () => {
  it('renders a one-line-per-projection table', () => {
    const p: Projection = { service: a, remotePort: 5432, mirrored: true, status: 'active' };
    const text = renderStatus([p]);
    expect(text).toContain('docker:pw-db:5432');
    expect(text).toContain('5432');
    expect(text).toContain('active');
  });
});
