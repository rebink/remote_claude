import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { runWhoami } from '../../src/commands/whoami.ts';

describe('patchwire whoami', () => {
  let dir: string;
  let projectsRoot: string;
  let cwd: string;
  let port: number;
  let app: ReturnType<typeof buildServer>;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pw-whoami-'));
    projectsRoot = join(dir, 'projects');
    cwd = join(dir, 'proj');
    mkdirSync(cwd, { recursive: true });
    const store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    app = buildServer({
      usersStore: store, projectsRoot,
      aiCommand: 'sh', aiArgs: [], timeoutSec: 5, version: '0-test',
    });
    const addr = await app.listen({ host: '127.0.0.1', port: 0 });
    port = Number(addr.split(':').pop());
    writeFileSync(
      join(cwd, 'patchwire.yml'),
      [
        'project: demo',
        'remote:',
        '  host: 127.0.0.1',
        '  user: nobody',
        '  path: /tmp/demo',
        `  agentUrl: http://127.0.0.1:${port}`,
        '  token: alice-token',
      ].join('\n'),
    );
    logs = [];
    logSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints the authenticated username', async () => {
    await runWhoami(cwd);
    expect(logs.join('')).toMatch(/^alice\b/);
  });
});
