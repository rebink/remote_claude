import { describe, it, expect } from 'vitest';
import { parseHostLogs, formatLogEntry } from './host-logs.ts';
describe('parseHostLogs', () => {
  it('ok with entries', () => {
    const line = JSON.stringify({ ok: true, entries: [{ ts: 't1', user: 'u', project: 'p', route: '/ask' }] });
    expect(parseHostLogs(line)).toEqual({ ok: true, entries: [{ ts: 't1', user: 'u', project: 'p', route: '/ask' }] });
  });
  it('failure line → ok:false', () => {
    expect(parseHostLogs('{"ok":false,"code":"log_failed","detail":"x"}')).toMatchObject({ ok: false });
  });
  it('garbage → ok:false', () => {
    expect(parseHostLogs('not json')).toEqual({ ok: false, entries: [] });
  });
});
describe('formatLogEntry', () => {
  it('formats ts/user/project/route', () => {
    expect(formatLogEntry({ ts: '2026-06-14T00:00:00Z', user: 'admin', project: 'demo', route: '/ask' }))
      .toBe('2026-06-14T00:00:00Z  admin  demo  /ask');
  });
  it('tolerates missing fields', () => {
    expect(formatLogEntry({ ts: 't' })).toBe('t  ?  ?  ?');
  });
});
