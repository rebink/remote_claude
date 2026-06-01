import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveUserFromHeader } from '../../src/agent/auth.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { buildServer } from '../../src/agent/server.ts';

describe('resolveUserFromHeader', () => {
  let dir: string;
  let store: UsersStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-auth-'));
    store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    store.disable('bob');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the user for a valid Bearer header', () => {
    expect(resolveUserFromHeader('Bearer alice-token', store))
      .toEqual({ user: 'alice', disabled: false });
  });

  it('returns null for a missing header', () => {
    expect(resolveUserFromHeader(undefined, store)).toBeNull();
  });

  it('returns null for a header without the Bearer prefix', () => {
    expect(resolveUserFromHeader('alice-token', store)).toBeNull();
  });

  it('returns null for an unknown token', () => {
    expect(resolveUserFromHeader('Bearer not-real', store)).toBeNull();
  });

  it('returns user + disabled=true for a disabled user', () => {
    expect(resolveUserFromHeader('Bearer bob-token', store))
      .toEqual({ user: 'bob', disabled: true });
  });

  it('trims surrounding whitespace in the token portion', () => {
    expect(resolveUserFromHeader('Bearer   alice-token  ', store))
      .toEqual({ user: 'alice', disabled: false });
  });
});

describe('server auth hook (multi-user)', () => {
  let dir: string;
  let projectsRoot: string;
  let store: UsersStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-srv-auth-'));
    projectsRoot = join(dir, 'projects');
    store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    store.disable('bob');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function app() {
    return buildServer({
      usersStore: store,
      projectsRoot,
      aiCommand: 'sh',
      aiArgs: [],
      timeoutSec: 5,
      version: 'x',
    });
  }

  it('GET /health is unauthenticated', async () => {
    const a = app();
    const res = await a.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await a.close();
  });

  it('GET /me returns 401 with no token', async () => {
    const a = app();
    const res = await a.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it('GET /me returns 401 for an unknown token', async () => {
    const a = app();
    const res = await a.inject({
      method: 'GET', url: '/me',
      headers: { authorization: 'Bearer not-real' },
    });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it('GET /me returns 403 for a disabled user', async () => {
    const a = app();
    const res = await a.inject({
      method: 'GET', url: '/me',
      headers: { authorization: 'Bearer bob-token' },
    });
    expect(res.statusCode).toBe(403);
    await a.close();
  });

  it('GET /me returns the username and createdAt for a valid user', async () => {
    const a = app();
    const res = await a.inject({
      method: 'GET', url: '/me',
      headers: { authorization: 'Bearer alice-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: string; createdAt: string; disabled: boolean };
    expect(body.user).toBe('alice');
    expect(body.disabled).toBe(false);
    expect(typeof body.createdAt).toBe('string');
    await a.close();
  });

  it('successful request updates lastSeen on the user', async () => {
    const a = app();
    const before = store.list().find((u) => u.user === 'alice')!.lastSeen;
    expect(before).toBeUndefined();
    await a.inject({
      method: 'GET', url: '/me',
      headers: { authorization: 'Bearer alice-token' },
    });
    const after = store.list().find((u) => u.user === 'alice')!.lastSeen;
    expect(typeof after).toBe('string');
    await a.close();
  });
});
