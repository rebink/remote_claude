import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateProjectsToDefault } from '../../src/agent/migrate-projects.ts';

describe('migrateProjectsToDefault', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pw-mproj-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function makeGitProject(parent: string, name: string): string {
    const dir = join(parent, name);
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    return dir;
  }

  it('moves a top-level git project into default/', () => {
    makeGitProject(root, 'myapp');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual(['myapp']);
    expect(existsSync(join(root, 'default', 'myapp', '.git'))).toBe(true);
    expect(existsSync(join(root, 'myapp'))).toBe(false);
  });

  it('moves multiple top-level projects', () => {
    makeGitProject(root, 'app-a');
    makeGitProject(root, 'app-b');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved.sort()).toEqual(['app-a', 'app-b']);
    expect(existsSync(join(root, 'default', 'app-a', '.git'))).toBe(true);
    expect(existsSync(join(root, 'default', 'app-b', '.git'))).toBe(true);
  });

  it('skips dirs without a .git child', () => {
    mkdirSync(join(root, 'just-a-folder'));
    writeFileSync(join(root, 'just-a-folder', 'notes.md'), 'hi\n');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual([]);
    expect(existsSync(join(root, 'just-a-folder'))).toBe(true);
  });

  it('skips dirs whose name does not match the project regex', () => {
    mkdirSync(join(root, 'has space'), { recursive: true });
    mkdirSync(join(root, 'has space', '.git'), { recursive: true });
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual([]);
    expect(existsSync(join(root, 'has space'))).toBe(true);
  });

  it('does not touch existing user namespace dirs (default, alice)', () => {
    mkdirSync(join(root, 'default'));
    makeGitProject(join(root, 'default'), 'already-migrated');
    mkdirSync(join(root, 'alice'));
    makeGitProject(join(root, 'alice'), 'alice-proj');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual([]);
    expect(existsSync(join(root, 'default', 'already-migrated', '.git'))).toBe(true);
    expect(existsSync(join(root, 'alice', 'alice-proj', '.git'))).toBe(true);
  });

  it('mixes the two: moves top-level project alongside existing user dirs', () => {
    mkdirSync(join(root, 'alice'));
    makeGitProject(join(root, 'alice'), 'alice-proj');
    makeGitProject(root, 'leftover');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual(['leftover']);
    expect(existsSync(join(root, 'default', 'leftover', '.git'))).toBe(true);
    expect(existsSync(join(root, 'alice', 'alice-proj', '.git'))).toBe(true);
    expect(existsSync(join(root, 'leftover'))).toBe(false);
  });

  it('refuses to overwrite if default/<name>/ already exists', () => {
    makeGitProject(root, 'collide');
    mkdirSync(join(root, 'default', 'collide'), { recursive: true });
    writeFileSync(join(root, 'default', 'collide', 'existing.txt'), 'do not lose me\n');
    expect(() => migrateProjectsToDefault({ projectsRoot: root })).toThrow(/already exists/);
    // Source still intact (refused, did not partially move)
    expect(existsSync(join(root, 'collide'))).toBe(true);
  });

  it('is idempotent — running twice on a clean tree is a no-op', () => {
    const r1 = migrateProjectsToDefault({ projectsRoot: root });
    const r2 = migrateProjectsToDefault({ projectsRoot: root });
    expect(r1.moved).toEqual([]);
    expect(r2.moved).toEqual([]);
  });

  it('creates default/ even when empty (so subsequent rsync targets exist)', () => {
    makeGitProject(root, 'first');
    migrateProjectsToDefault({ projectsRoot: root });
    expect(statSync(join(root, 'default')).isDirectory()).toBe(true);
  });
});
