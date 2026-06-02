import { describe, it, expect } from 'vitest';
import { aggregateUsage, humanizeMs } from '../../src/agent/usage.ts';
import type { AskAuditEntry, ChatAuditEntry } from '../../src/agent/audit-log.ts';

function ask(over: Partial<AskAuditEntry>): AskAuditEntry {
  return {
    route: '/ask', ts: '2026-06-02T10:00:00.000Z',
    user: 'alice', project: 'app', prompt_sha256: 'a'.repeat(64),
    files: 1, lines_added: 0, lines_removed: 0,
    duration_ms: 1000, queue_wait_ms: 0, exit_code: 0, ...over,
  };
}
function chat(over: Partial<ChatAuditEntry>): ChatAuditEntry {
  return {
    route: '/chat', ts: '2026-06-02T10:00:00.000Z',
    user: 'alice', project: 'app', prompt_sha256: 'a'.repeat(64),
    duration_ms: 1000, queue_wait_ms: 0,
    uuid: 'u'.repeat(36), tokens_in: 10, tokens_out: 20, ...over,
  };
}

describe('aggregateUsage', () => {
  it('returns empty users and zeroed totals for no entries', () => {
    const r = aggregateUsage([]);
    expect(r.users).toEqual([]);
    expect(r.totals.requests).toBe(0);
    expect(r.totals.accepted).toBe(0);
  });

  it('counts requests, accepted (exit 0), and sums lines/duration per user', () => {
    const r = aggregateUsage([
      ask({ user: 'alice', lines_added: 5, lines_removed: 2, duration_ms: 1000, exit_code: 0 }),
      ask({ user: 'alice', lines_added: 3, lines_removed: 0, duration_ms: 2000, exit_code: 1 }),
    ]);
    expect(r.users).toHaveLength(1);
    const a = r.users[0];
    expect(a.user).toBe('alice');
    expect(a.requests).toBe(2);
    expect(a.accepted).toBe(1);
    expect(a.ask).toBe(2);
    expect(a.lines_added).toBe(8);
    expect(a.lines_removed).toBe(2);
    expect(a.duration_ms).toBe(3000);
  });

  it('treats every /chat as accepted and sums tokens', () => {
    const r = aggregateUsage([chat({ user: 'bob', tokens_in: 10, tokens_out: 20 })]);
    const b = r.users[0];
    expect(b.chat).toBe(1);
    expect(b.accepted).toBe(1);
    expect(b.tokens_in).toBe(10);
    expect(b.tokens_out).toBe(20);
  });

  it('sorts users by requests desc then name asc, and computes totals', () => {
    const r = aggregateUsage([
      ask({ user: 'ana' }), ask({ user: 'ana' }), ask({ user: 'ana' }),
      ask({ user: 'ben' }),
      ask({ user: 'cleo' }), ask({ user: 'cleo' }),
    ]);
    expect(r.users.map((u) => u.user)).toEqual(['ana', 'cleo', 'ben']);
    expect(r.totals.user).toBe('total');
    expect(r.totals.requests).toBe(6);
  });
});

describe('humanizeMs', () => {
  it('formats sub-minute as seconds', () => { expect(humanizeMs(45_000)).toBe('45s'); });
  it('formats minutes and seconds', () => { expect(humanizeMs(123_000)).toBe('2m 3s'); });
  it('formats hours and minutes', () => { expect(humanizeMs(3_720_000)).toBe('1h 2m'); });
  it('handles zero and negatives', () => {
    expect(humanizeMs(0)).toBe('0s');
    expect(humanizeMs(-5)).toBe('0s');
  });
});
