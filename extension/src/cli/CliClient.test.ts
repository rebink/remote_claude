import { describe, it, expect } from 'vitest';
import { parseJsonl } from './CliClient.ts';

describe('parseJsonl', () => {
  it('handles buffer splits across newlines', () => {
    const out: unknown[] = [];
    const consume = parseJsonl((e) => out.push(e));
    consume('{"type":"a"}\n{"type":"b');
    consume('"}\n{"type":"c"}\n');
    expect(out).toEqual([{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
  });
});
