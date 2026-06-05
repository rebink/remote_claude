import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { NoopAuditLog } from '../../src/agent/audit-log.ts';
import type { AskEvent } from '@patchwire/protocol';

/** Pull the diff from the streamed NDJSON `/ask` `result` event. */
function askDiff(payload: string): string {
  const result = payload
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AskEvent)
    .find((e) => e.type === 'result');
  return result?.type === 'result' ? result.diff : '__no_result__';
}

describe('per-user paths end-to-end', () => {
  let dir: string;
  let app: ReturnType<typeof buildServer>;

  function git(args: string[], cwd: string): string {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout || 'unknown error'}`);
    }
    return r.stdout;
  }

  function makeProject(parent: string, name: string, content: string): void {
    const p = join(parent, name);
    mkdirSync(p, { recursive: true });
    git(['init', '-q', '-b', 'main'], p);
    git(['config', 'user.email', 't@example.com'], p);
    git(['config', 'user.name', 'T'], p);
    git(['config', 'commit.gpgsign', 'false'], p);
    writeFileSync(join(p, 'README.md'), content);
    git(['add', '-f', 'README.md'], p);
    git(['commit', '-q', '-m', 'init'], p);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-perusr-e2e-'));
    const store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    makeProject(join(dir, 'alice'), 'myapp', "# Alice's app\n");
    makeProject(join(dir, 'bob'), 'myapp', "# Bob's app\n");
    app = buildServer({
      usersStore: store, projectsRoot: dir,
      aiCommand: 'sh', aiArgs: ['-c', 'true'], timeoutSec: 5, version: 'e2e',
      auditLog: new NoopAuditLog(),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Quarantined on CI: asserts on the hijacked `/ask` NDJSON stream captured via
  // `app.inject`, which is timing-fragile on CI runners. Per-user isolation is also
  // covered by the 404 test below and multi-user.e2e; this runs locally (macOS).
  // TODO: rewrite against a real listening server so it's deterministic everywhere.
  it.skipIf(!!process.env.CI)('Alice and Bob each see only their own project named "myapp"', async () => {
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST', url: '/ask',
        headers: { authorization: 'Bearer alice-token', 'content-type': 'application/json' },
        payload: { prompt: 'noop', project: 'myapp' },
      }),
      app.inject({
        method: 'POST', url: '/ask',
        headers: { authorization: 'Bearer bob-token', 'content-type': 'application/json' },
        payload: { prompt: 'noop', project: 'myapp' },
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(askDiff(a.payload)).toBe('');
    expect(askDiff(b.payload)).toBe('');
  });

  it('a user with no project at the expected path gets 404 even if another user has that name', async () => {
    rmSync(join(dir, 'bob'), { recursive: true });
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: 'Bearer bob-token', 'content-type': 'application/json' },
      payload: { prompt: 'noop', project: 'myapp' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a project name with .. is rejected (path stays under user root)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: 'Bearer alice-token', 'content-type': 'application/json' },
      payload: { prompt: 'noop', project: '..' },
    });
    // `..` passes the Zod regex (which allows `.`), so the escape guard fires → 400.
    expect(res.statusCode).toBe(400);
  });
});
