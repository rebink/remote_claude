import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.ts';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

describe('VERSION', () => {
  it('is the single source of truth, matching package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
  it('is 0.3.1', () => {
    expect(VERSION).toBe('0.3.1');
  });
});
