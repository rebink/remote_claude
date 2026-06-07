import { describe, it, expect } from 'vitest';
import { aggregateUsage } from '../src/agent/usage.ts';
import type { AskAuditEntry, ChatAuditEntry } from '../src/agent/audit-log.ts';

function ask(user: string, extra: Partial<AskAuditEntry>): AskAuditEntry {
  return {
    route: '/ask', ts: '2026-06-08T00:00:00Z', user, project: 'p',
    prompt_sha256: 'x', duration_ms: 1000, queue_wait_ms: 0,
    files: 1, lines_added: 5, lines_removed: 1, exit_code: 0,
    ...extra,
  };
}
function chat(user: string, extra: Partial<ChatAuditEntry>): ChatAuditEntry {
  return {
    route: '/chat', ts: '2026-06-08T00:00:00Z', user, project: 'p',
    prompt_sha256: 'x', duration_ms: 500, queue_wait_ms: 0,
    uuid: 'u', tokens_in: 0, tokens_out: 0,
    ...extra,
  };
}

describe('aggregateUsage — cost & tokens', () => {
  it('sums tokens across both /ask and /chat', () => {
    const r = aggregateUsage([
      ask('ana', { tokens_in: 100, tokens_out: 20 }),
      chat('ana', { tokens_in: 30, tokens_out: 5 }),
    ]);
    const ana = r.users.find((u) => u.user === 'ana')!;
    expect(ana.tokens_in).toBe(130);
    expect(ana.tokens_out).toBe(25);
    expect(r.totals.tokens_in).toBe(130);
  });

  it('sums reported cost and marks has_cost without cost_estimated', () => {
    const r = aggregateUsage([
      ask('ben', { cost_usd: 0.10, cost_source: 'reported' }),
      ask('ben', { cost_usd: 0.05, cost_source: 'reported' }),
    ]);
    const ben = r.users.find((u) => u.user === 'ben')!;
    expect(ben.cost_usd).toBeCloseTo(0.15);
    expect(ben.has_cost).toBe(true);
    expect(ben.cost_estimated).toBe(false);
  });

  it('flags cost_estimated when any contributing entry was estimated', () => {
    const r = aggregateUsage([
      ask('ren', { cost_usd: 0.10, cost_source: 'reported' }),
      ask('ren', { cost_usd: 0.02, cost_source: 'estimated' }),
    ]);
    const ren = r.users.find((u) => u.user === 'ren')!;
    expect(ren.cost_usd).toBeCloseTo(0.12);
    expect(ren.cost_estimated).toBe(true);
  });

  it('leaves has_cost false when no entry carried a cost', () => {
    const r = aggregateUsage([ask('zoe', {}), chat('zoe', {})]);
    const zoe = r.users.find((u) => u.user === 'zoe')!;
    expect(zoe.has_cost).toBe(false);
    expect(zoe.cost_usd).toBe(0);
  });
});
