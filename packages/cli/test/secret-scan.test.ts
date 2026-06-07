import { describe, it, expect } from 'vitest';
import { parseGitleaksReport, decideScanGate } from '../src/lib/secret-scan.ts';

describe('parseGitleaksReport', () => {
  it('returns [] for empty / whitespace / invalid JSON', () => {
    expect(parseGitleaksReport('')).toEqual([]);
    expect(parseGitleaksReport('   ')).toEqual([]);
    expect(parseGitleaksReport('not json')).toEqual([]);
    expect(parseGitleaksReport('{}')).toEqual([]); // object, not array
  });

  it('maps gitleaks finding fields (File/RuleID/StartLine)', () => {
    const report = JSON.stringify([
      { RuleID: 'aws-access-key', File: 'src/config.ts', StartLine: 12 },
      { RuleID: 'generic-api-key', File: '.env.example', StartLine: 3 },
    ]);
    const findings = parseGitleaksReport(report);
    expect(findings).toEqual([
      { file: 'src/config.ts', rule: 'aws-access-key', line: 12 },
      { file: '.env.example', rule: 'generic-api-key', line: 3 },
    ]);
  });

  it('tolerates missing optional fields', () => {
    const findings = parseGitleaksReport(JSON.stringify([{ File: 'x' }]));
    expect(findings[0]).toEqual({ file: 'x', rule: 'secret' });
  });
});

describe('decideScanGate', () => {
  it('proceeds when mode is off regardless of findings', () => {
    expect(decideScanGate('off', 5, false).proceed).toBe(true);
  });

  it('proceeds with no message when there are zero findings', () => {
    expect(decideScanGate('block', 0, false)).toEqual({ proceed: true });
  });

  it('warn mode proceeds but returns a message when findings exist', () => {
    const d = decideScanGate('warn', 2, false);
    expect(d.proceed).toBe(true);
    expect(d.message).toMatch(/2 potential secrets/);
  });

  it('block mode refuses (no force) when findings exist', () => {
    const d = decideScanGate('block', 1, false);
    expect(d.proceed).toBe(false);
    expect(d.message).toMatch(/Refusing to sync/);
  });

  it('block mode proceeds with --force despite findings', () => {
    const d = decideScanGate('block', 3, true);
    expect(d.proceed).toBe(true);
    expect(d.message).toMatch(/--force/);
  });
});
