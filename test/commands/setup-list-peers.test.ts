import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSetupListPeers } from '../../src/commands/setup.ts';
import * as ts from '../../src/lib/tailscale.ts';

describe('setup --list-peers --json', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a JSON array of {host, hostname, online, lastSeen}', async () => {
    vi.spyOn(ts, 'getPeers').mockResolvedValue([
      {
        hostname: 'mac-mini',
        host: 'mac-mini.tail-abc.ts.net',
        online: true,
        lastSeen: '2026-05-20T12:00:00Z',
      },
    ]);
    const out: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stdout.write = ((chunk: any) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await runSetupListPeers();
    } finally {
      process.stdout.write = origWrite;
    }

    const parsed = JSON.parse(out.join(''));
    expect(parsed).toEqual([
      {
        hostname: 'mac-mini',
        host: 'mac-mini.tail-abc.ts.net',
        online: true,
        lastSeen: '2026-05-20T12:00:00Z',
      },
    ]);
  });
});
