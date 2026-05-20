import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { diffHead } from '../../src/agent/git.ts';

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
