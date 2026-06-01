import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveUserFromHeader } from '../../src/agent/auth.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

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
