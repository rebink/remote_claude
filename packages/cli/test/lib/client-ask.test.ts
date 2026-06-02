import { describe, it, expect } from 'vitest';
import { parseAskStream } from '../../src/lib/client.ts';
import type { AskEvent } from '@patchwire/protocol';

/** Build an async iterable of decoded chunks from a list of NDJSON string pieces. */
async function* chunks(...pieces: string[]): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  for (const p of pieces) yield enc.encode(p);
}

describe('parseAskStream', () => {
  it('collapses queued/accepted/result into an AskResponse and forwards events', async () => {
    const seen: AskEvent[] = [];
    const res = await parseAskStream(
      chunks(
        '{"type":"queued","position":2}\n',
        '{"type":"accepted","queueWaitMs":120}\n{"type":"result","diff":"D","files":["a.txt"],"durationMs":5,"stdout":"o","stderr":"e","exitCode":0}\n',
      ),
      (e) => seen.push(e),
    );
    expect(res).toEqual({ diff: 'D', files: ['a.txt'], durationMs: 5, stdout: 'o', stderr: 'e', exitCode: 0 });
    expect(seen.map((e) => e.type)).toEqual(['queued', 'accepted', 'result']);
  });

  it('throws on an error event, carrying the message', async () => {
    await expect(
      parseAskStream(chunks('{"type":"error","code":"run_failed","message":"boom"}\n'), () => {}),
    ).rejects.toThrow('boom');
  });

  it('throws when the stream ends without a terminal event', async () => {
    await expect(
      parseAskStream(chunks('{"type":"accepted","queueWaitMs":0}\n'), () => {}),
    ).rejects.toThrow('stream ended without result');
  });

  it('tolerates a line split across two chunks', async () => {
    const full =
      '{"type":"result","diff":"D","files":[],"durationMs":0,"stdout":"","stderr":"","exitCode":0}\n';
    const cut = 30; // arbitrary mid-line split point
    const res = await parseAskStream(chunks(full.slice(0, cut), full.slice(cut)), () => {});
    expect(res.diff).toBe('D');
  });
});
