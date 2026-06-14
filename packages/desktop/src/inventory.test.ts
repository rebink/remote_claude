import { describe, it, expect } from 'vitest';
import { recordToFormValues, hostBadge } from './inventory.ts';
import type { HostRecord } from './host-record.ts';
const rec: HostRecord = { id: 'h1', label: 'admin@10.0.0.2', host: '10.0.0.2', user: 'admin', port: 22, keyPath: '~/.ssh/k', agentPort: 7878, lastStatus: 'completed', lastHealth: 'healthy', lastProvisionedAt: '2026-06-14T00:00:00Z' };
describe('recordToFormValues', () => {
  it('maps a record to wizard form string values', () => {
    expect(recordToFormValues(rec)).toEqual({ host: '10.0.0.2', user: 'admin', port: '22', keyPath: '~/.ssh/k', agentPort: '7878' });
  });
});
describe('hostBadge', () => {
  it('completed + healthy → ok', () => { expect(hostBadge(rec)).toEqual({ text: 'healthy', cls: 'badge-ok' }); });
  it('rolled-back → failed', () => { expect(hostBadge({ ...rec, lastStatus: 'rolled-back', lastHealth: undefined })).toEqual({ text: 'failed', cls: 'badge-failed' }); });
  it('completed but unhealthy agent → warn', () => { expect(hostBadge({ ...rec, lastHealth: 'unhealthy' })).toEqual({ text: 'unhealthy', cls: 'badge-warn' }); });
});
