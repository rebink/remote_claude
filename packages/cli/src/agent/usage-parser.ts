/**
 * Normalized usage extracted from an AI CLI's output. `costSource`:
 * - `reported`  — the provider's own tool gave us a dollar figure (Claude
 *   `total_cost_usd`, Aider `Cost: $…`). No price table involved.
 * - `estimated` — set LATER by the pricing fallback (tokens × operator rate).
 * - `none`      — no cost known (yet).
 */
export interface UsageReport {
  model?: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  costSource: 'reported' | 'estimated' | 'none';
}

function empty(): UsageReport {
  return { tokensIn: 0, tokensOut: 0, costSource: 'none' };
}

/** Parse "1.2k" / "345" / "2.0M" → a number. Returns 0 on garbage. */
function parseTokenNum(raw: string): number {
  const m = raw.trim().replace(/,/g, '').match(/^([\d.]+)\s*([kKmM]?)$/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const suffix = (m[2] ?? '').toLowerCase();
  if (suffix === 'k') return Math.round(n * 1_000);
  if (suffix === 'm') return Math.round(n * 1_000_000);
  return Math.round(n);
}

/** Pull a UsageReport out of a single Claude result-shaped object. */
function fromClaudeObject(o: Record<string, unknown>): UsageReport {
  const usage = (o.usage ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const report = empty();
  report.tokensIn = num(usage.input_tokens) ?? 0;
  report.tokensOut = num(usage.output_tokens) ?? 0;
  const cacheRead = num(usage.cache_read_input_tokens);
  if (cacheRead !== undefined) report.cacheReadTokens = cacheRead;
  const cacheCreate = num(usage.cache_creation_input_tokens);
  if (cacheCreate !== undefined) report.cacheCreationTokens = cacheCreate;
  if (typeof o.model === 'string') report.model = o.model;
  const cost = num(o.total_cost_usd);
  if (cost !== undefined) {
    report.costUsd = cost;
    report.costSource = 'reported';
  }
  return report;
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Last NDJSON line whose object looks like a Claude `result` (or carries usage). */
function fromStreamJson(text: string): UsageReport | null {
  const objects = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(tryParseJsonObject)
    .filter((o): o is Record<string, unknown> => o !== null);
  if (!objects.length) return null;
  const result = [...objects].reverse().find((o) => o.type === 'result' || 'usage' in o || 'total_cost_usd' in o);
  return result ? fromClaudeObject(result) : null;
}

/** Aider prints `Tokens: X sent, Y received.` and `Cost: $Z message, …`. */
function fromAiderText(text: string): UsageReport | null {
  const tok = text.match(/Tokens:\s*([\d.,]+\s*[kKmM]?)\s*sent,\s*([\d.,]+\s*[kKmM]?)\s*received/);
  const cost = text.match(/Cost:\s*\$([\d.]+)/);
  if (!tok && !cost) return null;
  const report = empty();
  if (tok) {
    report.tokensIn = parseTokenNum(tok[1]!);
    report.tokensOut = parseTokenNum(tok[2]!);
  }
  if (cost) {
    const c = Number(cost[1]);
    if (Number.isFinite(c)) {
      report.costUsd = c;
      report.costSource = 'reported';
    }
  }
  return report;
}

/**
 * Extract real token/cost usage from an AI CLI's stdout. Format-agnostic:
 * tries a single Claude JSON object, then a Claude stream-json transcript,
 * then Aider's text lines, then gives up with a `none` report. Never throws.
 *
 * Replaces the placeholder in the chat runner (`tokensOut = output.length`),
 * which was a character count, not a token count.
 */
export function parseAiUsage(output: string): UsageReport {
  const text = (output ?? '').trim();
  if (!text) return empty();

  const single = tryParseJsonObject(text);
  if (single) return fromClaudeObject(single);

  const stream = fromStreamJson(text);
  if (stream) return stream;

  const aider = fromAiderText(text);
  if (aider) return aider;

  return empty();
}
