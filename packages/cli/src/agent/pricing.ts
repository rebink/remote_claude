import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { UsageReport } from './usage-parser.ts';

/** Per-model rate, in dollars per million tokens. Cache rates optional. */
export interface ModelRate {
  in_per_mtok: number;
  out_per_mtok: number;
  cache_read_per_mtok?: number;
  cache_creation_per_mtok?: number;
}

export interface PricingTable {
  models: Record<string, ModelRate>;
}

/**
 * Load an optional operator-maintained pricing table (YAML) used ONLY as a
 * fallback when the provider doesn't report a dollar cost itself. Returns null
 * when the file is missing or malformed — a missing table simply means
 * token-only providers show no `$` (never a crash, never a guess).
 *
 * Rates change over time, so this lives in operator config, never in code.
 */
export function loadPricing(path: string): PricingTable | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = parseYaml(readFileSync(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const models = (parsed as Record<string, unknown>).models;
    if (!models || typeof models !== 'object') return null;
    return { models: models as Record<string, ModelRate> };
  } catch {
    return null;
  }
}

/**
 * Fill in `costUsd` from token counts × the operator rate table when the
 * provider didn't report a cost. Never overrides a `reported` cost (reported
 * always wins). Marks the result `estimated` so the UI can flag it (`~$…`).
 * If the model has no rate, the usage is returned unchanged (`costSource: none`).
 */
export function estimateCost(usage: UsageReport, pricing: PricingTable | null): UsageReport {
  if (usage.costSource === 'reported') return usage;
  if (!pricing || !usage.model) return usage;
  const rate = pricing.models[usage.model];
  if (!rate) return usage;

  const M = 1_000_000;
  let cost = (usage.tokensIn / M) * rate.in_per_mtok + (usage.tokensOut / M) * rate.out_per_mtok;
  if (usage.cacheReadTokens && rate.cache_read_per_mtok !== undefined) {
    cost += (usage.cacheReadTokens / M) * rate.cache_read_per_mtok;
  }
  if (usage.cacheCreationTokens && rate.cache_creation_per_mtok !== undefined) {
    cost += (usage.cacheCreationTokens / M) * rate.cache_creation_per_mtok;
  }
  return { ...usage, costUsd: cost, costSource: 'estimated' };
}
