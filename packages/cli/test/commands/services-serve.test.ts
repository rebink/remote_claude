// packages/cli/test/commands/services-serve.test.ts
import { describe, it, expect } from 'vitest';
import { makeStdioIo } from '../../src/commands/services.ts';

describe('makeStdioIo', () => {
  it('writes newline-delimited JSON to the sink and parses lines from the source', () => {
    const out: string[] = [];
    const handlers: Record<string, (b: string) => void> = {};
    const source = { on: (ev: string, cb: (b: string) => void) => { handlers[ev] = cb; } } as never;
    const sink = { write: (s: string) => { out.push(s); } } as never;
    const io = makeStdioIo(source, sink);

    const lines: string[] = [];
    io.onLine((l) => lines.push(l));
    io.write({ type: 'status', projections: [] });
    expect(out[0]).toBe('{"type":"status","projections":[]}\n');

    handlers['data']('{"cmd":"discover"}\n{"cmd":"unbind","id":"x"}\n');
    expect(lines).toEqual(['{"cmd":"discover"}', '{"cmd":"unbind","id":"x"}']);
  });
});
