import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { diffHead, isGitRepo } from '../../src/agent/git.ts';

describe('isGitRepo', () => {
  let tempDir: string;

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true for a git-inited directory', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pw-git-'));
    spawnSync('git', ['init', '-q'], { cwd: tempDir });
    expect(await isGitRepo(tempDir)).toBe(true);
  });

  it('returns false for a plain subdirectory nested inside a git repo', async () => {
    // tempDir is the git root from the previous test; create a plain sub-dir inside it
    const sub = join(tempDir, 'sub');
    mkdirSync(sub);
    expect(await isGitRepo(sub)).toBe(false);
  });
});

describe('diffHead rename handling', () => {
  it('captures the new path for a renamed file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-git-'));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    writeFileSync(join(dir, 'old.txt'), 'hello\n');
    spawnSync('git', ['add', 'old.txt'], { cwd: dir });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
    spawnSync('git', ['mv', 'old.txt', 'new.txt'], { cwd: dir });

    const result = await diffHead(dir);
    const renamed = result.files.find((f) => f.path === 'new.txt');
    expect(renamed).toBeDefined();
    expect(renamed?.status).toBe('R');
    rmSync(dir, { recursive: true, force: true });
  });
});
