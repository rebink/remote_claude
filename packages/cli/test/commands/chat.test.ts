import { describe, it, expect, vi, afterEach } from 'vitest';
import { runChat } from '../../src/commands/chat.ts';
import * as client from '../../src/lib/client.ts';
import * as config from '../../src/lib/config.ts';
import type { Config } from '../../src/lib/config.ts';

describe('runChat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits protocol, sync_*, then forwards agent events', async () => {
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
    vi.spyOn(client, 'streamPostNdjson').mockImplementation(async function* () {
      yield { type: 'chat_turn_start', sessionId: 'cid', turnIndex: 0 };
      yield { type: 'chat_text', chunk: 'hi' };
      yield { type: 'chat_done', tokensIn: 0, tokensOut: 2, durationMs: 100 };
    } as any);

    const out: any[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: any) => {
      out.push(
        ...String(c)
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l: string) => JSON.parse(l)),
      );
      return true;
    }) as typeof process.stdout.write;

    try {
      await runChat({ cwd: process.cwd(), prompt: 'hi', sessionUuid: 'u1', skipSync: true });
    } finally {
      process.stdout.write = origWrite;
    }

    expect(out[0]).toMatchObject({ type: 'protocol' });
    expect(out.find((e) => e.type === 'chat_done')).toBeDefined();
    expect(client.streamPostNdjson).toHaveBeenCalledWith(
      expect.anything(),
      '/chat',
      expect.objectContaining({ uuid: 'u1', prompt: 'hi' }),
    );
  });

  it('propagates streamPostNdjson errors (non-2xx response)', async () => {
    vi.spyOn(client, 'streamPostNdjson').mockImplementation(async function* () {
      throw new Error('Agent POST /chat failed: 401 unauthorized');
    } as any);
    vi.spyOn(config, 'loadConfig').mockResolvedValue({
      project: 'p',
      remote: { agentUrl: 'http://x', token: 't' },
    } as any);

    await expect(
      runChat({ cwd: process.cwd(), prompt: 'hi', sessionUuid: 'u1', skipSync: true }),
    ).rejects.toThrow(/401/);
  });
});
