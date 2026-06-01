import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateIfNeeded } from '../../src/agent/migrate-v01.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('migrateIfNeeded', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-migrate-'));
    path = join(dir, 'users.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates "default" user when users.json absent + legacy token present', () => {
    const result = migrateIfNeeded({ usersJsonPath: path, legacyToken: 'legacy-tok' });
    expect(result.migrated).toBe(true);
    expect(result.users).toBe(1);
    const s = new UsersStore(path);
    expect(s.lookupByToken('legacy-tok')).toEqual({ user: 'default', disabled: false });
  });

  it('does nothing when users.json already exists', () => {
    writeFileSync(path, '{}', { mode: 0o600 });
    const result = migrateIfNeeded({ usersJsonPath: path, legacyToken: 'legacy-tok' });
    expect(result.migrated).toBe(false);
  });

  it('does nothing when users.json absent + no legacy token', () => {
    const result = migrateIfNeeded({ usersJsonPath: path, legacyToken: undefined });
    expect(result.migrated).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it('does nothing when legacy token is empty string', () => {
    const result = migrateIfNeeded({ usersJsonPath: path, legacyToken: '' });
    expect(result.migrated).toBe(false);
    expect(existsSync(path)).toBe(false);
  });
});
