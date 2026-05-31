import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerDeleteSession } from '../../src/agent/server.ts';
import { SessionStore } from '../../src/agent/session-store.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('DELETE /session/:id', () => {
  it('removes the mapping and returns 204', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-del-'));
    const store = new SessionStore(join(dir, 'sessions.json'));
    await store.getOrCreate('u1');

    const app = Fastify();
    registerDeleteSession(app, store);
    const res = await app.inject({ method: 'DELETE', url: '/session/u1' });
    expect(res.statusCode).toBe(204);
    expect(await store.get('u1')).toBeUndefined();
  });

  it('is idempotent — DELETE on unknown id still returns 204', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-del-'));
    const store = new SessionStore(join(dir, 'sessions.json'));

    const app = Fastify();
    registerDeleteSession(app, store);
    const res = await app.inject({ method: 'DELETE', url: '/session/does-not-exist' });
    expect(res.statusCode).toBe(204);
  });
});
