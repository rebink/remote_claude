import { describe, it, expect, vi, afterEach } from 'vitest';
import { runInitRemote } from '../../src/commands/init-remote.ts';
import * as client from '../../src/lib/client.ts';
import * as config from '../../src/lib/config.ts';
import type { Config } from '../../src/lib/config.ts';

describe('init-remote', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to /init and returns the SHA', async () => {
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
    const spy = vi
      .spyOn(client, 'agentRequest')
      .mockResolvedValue({ ok: true, sha: 'abc123', path: '/tmp/p/app' });

    const res = await runInitRemote({ gitUrl: 'git@x:co/app.git', branch: 'main', project: 'app' });

    expect(res).toEqual({ ok: true, sha: 'abc123', path: '/tmp/p/app' });
    expect(spy).toHaveBeenCalledWith(fakeCfg, 'POST', '/init', {
      gitUrl: 'git@x:co/app.git',
      branch: 'main',
      projectName: 'app',
    });
  });
});
