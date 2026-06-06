import { describe, it, expect } from 'vitest';
import { CliClient, parseJsonl } from './CliClient.ts';
import type { CliInvocation } from './resolveCli.ts';

describe('parseJsonl', () => {
  it('handles buffer splits across newlines', () => {
    const out: unknown[] = [];
    const consume = parseJsonl((e) => out.push(e));
    consume('{"type":"a"}\n{"type":"b');
    consume('"}\n{"type":"c"}\n');
    expect(out).toEqual([{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
  });
});

describe('CliClient.spawn', () => {
  it('delivers events emitted before the consumer iterates', async () => {
    const inv: CliInvocation = { command: process.execPath, baseArgs: [], env: process.env };
    const cli = new CliClient(inv, process.cwd());
    const run = cli.spawn([
      '-e',
      `process.stdout.write('{"type":"chat_text","chunk":"hi"}\\n');` +
        `process.stdout.write('{"type":"chat_done","tokensIn":0,"tokensOut":2,"durationMs":1}\\n');`,
    ]);
    // Wait a tick to let the child fire its events (and exit) before we iterate.
    await new Promise((r) => setTimeout(r, 100));

    const seen: string[] = [];
    for await (const e of run.events) seen.push(e.type);
    await run.done;
    expect(seen).toEqual(['chat_text', 'chat_done']);
  });

  it('terminates with a synthetic error event when the binary is missing', async () => {
    const inv: CliInvocation = { command: '/this/binary/does/not/exist', baseArgs: [], env: process.env };
    const cli = new CliClient(inv, process.cwd());
    const run = cli.spawn(['--whatever']);
    const seen: { type: string }[] = [];
    for await (const e of run.events) seen.push(e);
    await run.done;
    expect(seen.some((e) => e.type === 'error')).toBe(true);
    // The key assertion: the loop EXITED (without the fix it would hang).
  });

  it('emits an error event for stderr and terminates cleanly', async () => {
    const inv: CliInvocation = { command: process.execPath, baseArgs: [], env: process.env };
    const cli = new CliClient(inv, process.cwd());
    const run = cli.spawn([
      '-e',
      `process.stdout.write('{"type":"chat_text","chunk":"ok"}\\n');` +
        `process.stderr.write('boom');` +
        `process.exit(0);`,
    ]);
    const seen: Array<{ type: string; message?: string }> = [];
    for await (const e of run.events) seen.push(e as { type: string; message?: string });
    await run.done;
    expect(seen.map((e) => e.type)).toEqual(['chat_text', 'error']);
    expect(seen[1]?.message).toBe('boom');
  });
});
