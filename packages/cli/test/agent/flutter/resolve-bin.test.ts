import { describe, it, expect } from 'vitest';
import { resolvePatchwireBin } from '../../../src/agent/flutter/resolve-bin.ts';

describe('resolvePatchwireBin', () => {
  it('defaults to the PATH-resolved patchwire command', () => {
    expect(resolvePatchwireBin({})).toBe('patchwire');
  });
  it('honors PW_CLI_BIN override', () => {
    expect(resolvePatchwireBin({ PW_CLI_BIN: '/opt/pw/patchwire' })).toBe('/opt/pw/patchwire');
  });
  it('ignores a blank override', () => {
    expect(resolvePatchwireBin({ PW_CLI_BIN: '   ' })).toBe('patchwire');
  });
});
