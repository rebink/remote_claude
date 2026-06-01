import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('multi-user end-to-end', () => {
  let dir: string;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pw-mu-e2e-'));
    const store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    app = buildServer({
      usersStore: store, projectsRoot: dir,
      aiCommand: 'sh', aiArgs: [], timeoutSec: 5, version: 'e2e',
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('two users hitting /me in parallel both succeed with their own identity', async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer alice-token' } }),
      app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer bob-token' } }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect((a.json() as { user: string }).user).toBe('alice');
    expect((b.json() as { user: string }).user).toBe('bob');
  });

  it('a third unknown token gets 401', async () => {
    const r = await app.inject({
      method: 'GET', url: '/me', headers: { authorization: 'Bearer nope' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('/health remains unauthenticated', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
  });
});
