import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('UsersStore policy', () => {
  let dir: string; let path: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-userpol-')); path = join(dir, 'users.json'); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns {} when a user has no policy', () => {
    const s = new UsersStore(path);
    s.addUser('ana', 'tok');
    expect(s.getPolicy('ana')).toEqual({});
  });

  it('sets and round-trips a project allowlist', () => {
    const s = new UsersStore(path);
    s.addUser('ana', 'tok');
    s.setProjects('ana', ['app', 'api']);
    expect(s.getPolicy('ana').projects).toEqual(['app', 'api']);
    // persisted: a fresh store reads it back
    expect(new UsersStore(path).getPolicy('ana').projects).toEqual(['app', 'api']);
  });

  it('sets and round-trips a rate limit', () => {
    const s = new UsersStore(path);
    s.addUser('ana', 'tok');
    s.setRateLimit('ana', { max: 50, windowMs: 3600_000 });
    expect(new UsersStore(path).getPolicy('ana').rateLimit).toEqual({ max: 50, windowMs: 3600_000 });
  });

  it('clearing both leaves no policy key in the persisted file', () => {
    const s = new UsersStore(path);
    s.addUser('ana', 'tok');
    s.setProjects('ana', ['app']);
    s.setRateLimit('ana', { max: 1, windowMs: 1000 });
    s.setProjects('ana', null);
    s.setRateLimit('ana', null);
    expect(s.getPolicy('ana')).toEqual({});
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect('policy' in raw.ana).toBe(false);
  });

  it('throws for an unknown user', () => {
    const s = new UsersStore(path);
    expect(() => s.setProjects('ghost', ['x'])).toThrow();
  });
});
