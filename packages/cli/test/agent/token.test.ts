import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '../../src/agent/token.ts';

describe('generateToken', () => {
  it('returns a 64-character hex string (32 bytes)', () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a different value on each call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe('hashToken', () => {
  it('returns a 64-character hex sha256', () => {
    expect(hashToken('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('matches the known sha256 of an empty string', () => {
    expect(hashToken('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
