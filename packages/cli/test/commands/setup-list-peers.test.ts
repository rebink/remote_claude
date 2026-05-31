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
    process.stdout.write = ((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await runSetupListPeers({ json: true });
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

  it('emits human-readable rows when --json is omitted', async () => {
    vi.spyOn(ts, 'getPeers').mockResolvedValue([
      { hostname: 'mac-mini', host: 'mac-mini.tail-abc.ts.net', online: true, lastSeen: '' },
      { hostname: 'laptop', host: '100.64.0.2', online: false, lastSeen: '' },
    ]);
    const out: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await runSetupListPeers({ json: false });
    } finally {
      process.stdout.write = origWrite;
    }

    const text = out.join('');
    expect(text).toContain('mac-mini\tmac-mini.tail-abc.ts.net\tonline');
    expect(text).toContain('laptop\t100.64.0.2\toffline');
  });
});
