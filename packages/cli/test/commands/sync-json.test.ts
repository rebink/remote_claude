import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSync } from '../../src/commands/sync.ts';
import * as rsync from '../../src/lib/rsync.ts';
import * as config from '../../src/lib/config.ts';
import type { Config } from '../../src/lib/config.ts';

describe('runSync(--json)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits sync_start, sync_progress*, sync_done as JSONL', async () => {
    const fakeCfg: Config = {
      project: 'app',
      remote: {
        host: 'mac-mini',
        user: 'me',
        path: '/tmp/p/app',
        agentUrl: 'http://mac-mini:7777',
        token: 'tkn',
      },
      sync: { exclude: [] },
      ai: { command: 'claude', args: ['--print'], timeoutSec: 600 },
    };
    vi.spyOn(config, 'loadConfig').mockResolvedValue(fakeCfg);
    vi.spyOn(rsync, 'rsyncPush').mockImplementation(async (_cfg, _cwd, onProgress) => {
      onProgress?.({ transferred: 100, total: 500 });
      onProgress?.({ transferred: 500, total: 500 });
      return { filesChanged: 3, durationMs: 42 };
    });

    const lines: any[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: any) => {
      String(c)
        .trim()
        .split('\n')
        .filter(Boolean)
        .forEach((l: string) => lines.push(JSON.parse(l)));
      return true;
    }) as typeof process.stdout.write;

    try {
      await runSync(process.cwd(), { json: true });
    } finally {
      process.stdout.write = origWrite;
    }

    expect(lines.map((l) => l.type)).toEqual([
      'sync_start',
      'sync_progress',
      'sync_progress',
      'sync_done',
    ]);
    expect(lines[lines.length - 1]).toMatchObject({
      type: 'sync_done',
      filesChanged: 3,
      durationMs: 42,
    });
  });
});
