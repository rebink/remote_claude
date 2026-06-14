import { describe, it, expect } from 'vitest';
import { parseHostHealth } from './host-health.ts';
describe('parseHostHealth', () => {
  it('healthy → ok badge', () => { expect(parseHostHealth('{"ok":true,"healthy":true,"version":"0.3.18"}')).toEqual({ text: 'healthy 0.3.18', cls: 'badge-ok' }); });
  it('reachable but unhealthy → warn', () => { expect(parseHostHealth('{"ok":true,"healthy":false}')).toEqual({ text: 'unhealthy', cls: 'badge-warn' }); });
  it('unreachable → failed', () => { expect(parseHostHealth('{"ok":false,"code":"unreachable"}')).toEqual({ text: 'unreachable', cls: 'badge-failed' }); });
  it('garbage → failed', () => { expect(parseHostHealth('not json')).toEqual({ text: 'error', cls: 'badge-failed' }); });
});
