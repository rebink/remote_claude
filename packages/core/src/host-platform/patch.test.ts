import { describe, it, expect } from 'vitest';
import { normalizePatch } from './patch.ts';

describe('normalizePatch', () => {
  it('converts CRLF to LF', () => {
    expect(normalizePatch('a\r\nb\r\n')).toBe('a\nb\n');
  });
  it('leaves LF-only text unchanged', () => {
    expect(normalizePatch('a\nb\n')).toBe('a\nb\n');
  });
});
