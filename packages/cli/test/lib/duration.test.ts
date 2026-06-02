import { describe, it, expect } from 'vitest';
import { parseDurationMs } from '../../src/lib/duration.ts';

describe('parseDurationMs', () => {
  it('parses s/m/h/d', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(parseDurationMs('6h')).toBe(21_600_000);
    expect(parseDurationMs('7d')).toBe(604_800_000);
  });
  it('throws on bad input', () => {
    expect(() => parseDurationMs('soon')).toThrow();
    expect(() => parseDurationMs('5x')).toThrow();
  });
});
