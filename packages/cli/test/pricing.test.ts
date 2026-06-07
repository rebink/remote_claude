import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPricing, estimateCost, type PricingTable } from '../src/agent/pricing.ts';
import type { UsageReport } from '../src/agent/usage-parser.ts';

const TABLE: PricingTable = {
  models: {
    'claude-opus-4-8': { in_per_mtok: 15, out_per_mtok: 75, cache_read_per_mtok: 1.5 },
    'gpt-5.2': { in_per_mtok: 10, out_per_mtok: 30 },
  },
};

function usage(partial: Partial<UsageReport>): UsageReport {
  return { tokensIn: 0, tokensOut: 0, costSource: 'none', ...partial };
}

describe('loadPricing', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-pricing-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null when the file does not exist', () => {
    expect(loadPricing(join(dir, 'nope.yml'))).toBeNull();
  });

  it('parses a YAML pricing table', () => {
    const p = join(dir, 'pricing.yml');
    writeFileSync(p, 'models:\n  gpt-5.2:\n    in_per_mtok: 10\n    out_per_mtok: 30\n');
    const table = loadPricing(p);
    expect(table?.models['gpt-5.2']).toEqual({ in_per_mtok: 10, out_per_mtok: 30 });
  });

  it('returns null on malformed YAML rather than throwing', () => {
    const p = join(dir, 'bad.yml');
    writeFileSync(p, 'models: [this is: not valid');
    expect(loadPricing(p)).toBeNull();
  });
});

describe('estimateCost', () => {
  it('leaves a reported cost untouched (reported wins over estimate)', () => {
    const u = usage({ model: 'gpt-5.2', tokensIn: 1_000_000, tokensOut: 0, costUsd: 0.99, costSource: 'reported' });
    const out = estimateCost(u, TABLE);
    expect(out.costUsd).toBe(0.99);
    expect(out.costSource).toBe('reported');
  });

  it('estimates from input+output tokens when cost is unknown', () => {
    const u = usage({ model: 'gpt-5.2', tokensIn: 1_000_000, tokensOut: 1_000_000 });
    const out = estimateCost(u, TABLE);
    // 1M in × $10/M + 1M out × $30/M = $40
    expect(out.costUsd).toBeCloseTo(40);
    expect(out.costSource).toBe('estimated');
  });

  it('adds cache-read cost when a cache rate is configured', () => {
    const u = usage({ model: 'claude-opus-4-8', tokensIn: 0, tokensOut: 0, cacheReadTokens: 1_000_000 });
    const out = estimateCost(u, TABLE);
    expect(out.costUsd).toBeCloseTo(1.5); // 1M cache-read × $1.5/M
    expect(out.costSource).toBe('estimated');
  });

  it('stays costSource=none when the model has no rate in the table', () => {
    const u = usage({ model: 'some-unlisted-model', tokensIn: 1_000_000 });
    const out = estimateCost(u, TABLE);
    expect(out.costUsd).toBeUndefined();
    expect(out.costSource).toBe('none');
  });

  it('stays none when there is no model at all', () => {
    const out = estimateCost(usage({ tokensIn: 500 }), TABLE);
    expect(out.costSource).toBe('none');
  });
});
