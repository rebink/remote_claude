import { describe, it, expect } from 'vitest';
import { parseAiUsage } from '../src/agent/usage-parser.ts';

describe('parseAiUsage — claude --output-format json', () => {
  const obj = {
    type: 'result',
    subtype: 'success',
    result: 'done',
    session_id: 'abc',
    total_cost_usd: 0.0123,
    model: 'claude-opus-4-8',
    usage: {
      input_tokens: 1200,
      output_tokens: 340,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 50,
    },
  };

  it('extracts reported cost + token + cache + model from a single JSON object', () => {
    const u = parseAiUsage(JSON.stringify(obj));
    expect(u.tokensIn).toBe(1200);
    expect(u.tokensOut).toBe(340);
    expect(u.cacheReadTokens).toBe(800);
    expect(u.cacheCreationTokens).toBe(50);
    expect(u.costUsd).toBeCloseTo(0.0123);
    expect(u.model).toBe('claude-opus-4-8');
    expect(u.costSource).toBe('reported');
  });

  it('tokens present but no total_cost_usd → costSource none (cost unknown, estimated later)', () => {
    const noCost = { ...obj, total_cost_usd: undefined };
    const u = parseAiUsage(JSON.stringify(noCost));
    expect(u.tokensIn).toBe(1200);
    expect(u.costUsd).toBeUndefined();
    expect(u.costSource).toBe('none');
  });
});

describe('parseAiUsage — claude --output-format stream-json', () => {
  it('reads the final result event from a multi-line NDJSON stream', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }),
      JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 5, output_tokens: 1 } } }),
      JSON.stringify({
        type: 'result',
        total_cost_usd: 0.02,
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 2000, output_tokens: 500 },
        result: 'ok',
      }),
    ].join('\n');
    const u = parseAiUsage(lines);
    expect(u.tokensIn).toBe(2000);
    expect(u.tokensOut).toBe(500);
    expect(u.costUsd).toBeCloseTo(0.02);
    expect(u.costSource).toBe('reported');
    expect(u.model).toBe('claude-sonnet-4-6');
  });
});

describe('parseAiUsage — aider text output', () => {
  it('parses the Tokens/Cost lines incl. k/M suffixes', () => {
    const out = [
      'Editing main.py',
      'Tokens: 1.2k sent, 345 received.',
      'Cost: $0.0042 message, $0.01 session.',
    ].join('\n');
    const u = parseAiUsage(out);
    expect(u.tokensIn).toBe(1200);
    expect(u.tokensOut).toBe(345);
    expect(u.costUsd).toBeCloseTo(0.0042);
    expect(u.costSource).toBe('reported');
  });
});

describe('parseAiUsage — no usable data', () => {
  it('plain text → zero tokens, no cost, costSource none', () => {
    const u = parseAiUsage('just some assistant prose with no usage block');
    expect(u.tokensIn).toBe(0);
    expect(u.tokensOut).toBe(0);
    expect(u.costUsd).toBeUndefined();
    expect(u.costSource).toBe('none');
  });

  it('empty / whitespace → none, never throws', () => {
    expect(parseAiUsage('').costSource).toBe('none');
    expect(parseAiUsage('   \n  ').tokensIn).toBe(0);
  });

  it('malformed JSON does not throw', () => {
    expect(() => parseAiUsage('{ not valid json')).not.toThrow();
    expect(parseAiUsage('{ not valid json').costSource).toBe('none');
  });
});
