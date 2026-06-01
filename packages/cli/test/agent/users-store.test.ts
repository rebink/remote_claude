import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsersStore } from '../../src/agent/users-store.ts';
import { hashToken } from '../../src/agent/token.ts';

describe('UsersStore', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-users-'));
    path = join(dir, 'users.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts empty when file does not exist', () => {
    const s = new UsersStore(path);
    expect(s.list()).toEqual([]);
  });

  it('addUser persists a sha256 hash, never plaintext', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'plaintext-token-value');
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('plaintext-token-value');
    expect(raw).toContain(hashToken('plaintext-token-value'));
  });

  it('persists with mode 0600', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('addUser rejects duplicate username', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok1');
    expect(() => s.addUser('alice', 'tok2')).toThrow(/already exists/);
  });

  it('addUser rejects invalid username (regex [a-zA-Z0-9_.-]+)', () => {
    const s = new UsersStore(path);
    expect(() => s.addUser('al ice', 'tok')).toThrow(/invalid username/);
    expect(() => s.addUser('../etc', 'tok')).toThrow(/invalid username/);
    expect(() => s.addUser('', 'tok')).toThrow(/invalid username/);
  });

  it('addUser rejects the reserved __admin__ name', () => {
    const s = new UsersStore(path);
    expect(() => s.addUser('__admin__', 'tok')).toThrow(/reserved/);
  });

  it('list returns user metadata without hashes', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    const [u] = s.list();
    expect(u.user).toBe('alice');
    expect(u.disabled).toBe(false);
    expect(typeof u.createdAt).toBe('string');
    expect((u as Record<string, unknown>).tokenHash).toBeUndefined();
  });

  it('lookupByToken returns the user for a valid plaintext token', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok-A');
    s.addUser('bob', 'tok-B');
    expect(s.lookupByToken('tok-A')).toEqual({ user: 'alice', disabled: false });
    expect(s.lookupByToken('tok-B')).toEqual({ user: 'bob', disabled: false });
  });

  it('lookupByToken returns null for unknown tokens', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    expect(s.lookupByToken('wrong')).toBeNull();
    expect(s.lookupByToken('')).toBeNull();
  });

  it('lookupByToken reports disabled state', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    s.disable('alice');
    expect(s.lookupByToken('tok')).toEqual({ user: 'alice', disabled: true });
  });

  it('rotate changes the hash and invalidates the old token', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'old');
    s.rotate('alice', 'new');
    expect(s.lookupByToken('old')).toBeNull();
    expect(s.lookupByToken('new')).toEqual({ user: 'alice', disabled: false });
  });

  it('remove drops the user', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    s.remove('alice');
    expect(s.list()).toEqual([]);
    expect(s.lookupByToken('tok')).toBeNull();
  });

  it('touchLastSeen updates lastSeen and persists', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    s.touchLastSeen('alice');
    const reloaded = new UsersStore(path);
    const u = reloaded.list().find((x) => x.user === 'alice')!;
    expect(typeof u.lastSeen).toBe('string');
  });

  it('reloading from disk preserves all users', () => {
    const s1 = new UsersStore(path);
    s1.addUser('alice', 'tok-A');
    s1.addUser('bob', 'tok-B');
    s1.disable('bob');
    const s2 = new UsersStore(path);
    expect(s2.list().map((u) => u.user).sort()).toEqual(['alice', 'bob']);
    expect(s2.lookupByToken('tok-A')).toEqual({ user: 'alice', disabled: false });
    expect(s2.lookupByToken('tok-B')).toEqual({ user: 'bob', disabled: true });
  });

  it('addAdmin stores the admin token under the reserved __admin__ key', () => {
    const s = new UsersStore(path);
    s.addAdmin('admin-token');
    // not visible in regular list
    expect(s.list().map((u) => u.user)).not.toContain('__admin__');
    // but lookupByToken finds it with a flag
    expect(s.lookupByToken('admin-token')).toEqual({ user: '__admin__', disabled: false });
  });

  it('does not crash if the file exists but is malformed', () => {
    writeFileSync(path, '{not json', { mode: 0o600 });
    const s = new UsersStore(path);
    expect(s.list()).toEqual([]);
  });
});
