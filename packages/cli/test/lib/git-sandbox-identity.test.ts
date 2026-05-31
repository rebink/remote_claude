import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitInitScript } from '../../src/lib/bootstrap-snapshot.ts';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'sandbox-id-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function runScriptIn(project: string): void {
  // gitInitScript hard-codes ~/workspace/<project>. We translate ~/workspace to workDir for the test
  // by overriding HOME so ~ expands into workDir/home and pre-creating workDir/home/workspace/<project>.
  const home = join(workDir, 'home');
  const projectDir = join(home, 'workspace', project);
  execFileSync('mkdir', ['-p', projectDir]);
  const script = gitInitScript(project);
  execFileSync('bash', ['-c', script], { env: { ...process.env, HOME: home } });
}

describe('git sandbox identity init script', () => {
  it('produces a repo with no remotes configured', () => {
    runScriptIn('demo');
    const remotes = execFileSync(
      'git',
      ['-C', join(workDir, 'home/workspace/demo'), 'remote', '-v'],
    ).toString();
    expect(remotes.trim()).toBe('');
  });

  it('sets local-only user.email and user.name without touching global config', () => {
    const beforeGlobalEmail = (() => {
      try {
        return execFileSync('git', ['config', '--global', '--get', 'user.email']).toString().trim();
      } catch {
        return '';
      }
    })();
    runScriptIn('demo');
    const localEmail = execFileSync(
      'git',
      ['-C', join(workDir, 'home/workspace/demo'), 'config', '--local', '--get', 'user.email'],
    ).toString().trim();
    expect(localEmail).toBe('patchwire@local');
    const localName = execFileSync(
      'git',
      ['-C', join(workDir, 'home/workspace/demo'), 'config', '--local', '--get', 'user.name'],
    ).toString().trim();
    expect(localName).toBe('Patchwire (sandbox)');
    // Global must be unchanged
    const afterGlobalEmail = (() => {
      try {
        return execFileSync('git', ['config', '--global', '--get', 'user.email']).toString().trim();
      } catch {
        return '';
      }
    })();
    expect(afterGlobalEmail).toBe(beforeGlobalEmail);
  });

  it('initial commit succeeds on an empty directory (--allow-empty path)', () => {
    runScriptIn('empty');
    const log = execFileSync(
      'git',
      ['-C', join(workDir, 'home/workspace/empty'), 'log', '--oneline'],
    ).toString().trim();
    expect(log).toMatch(/snapshot from laptop/);
  });

  it('initial commit stages all files on a populated directory', async () => {
    const project = 'populated';
    const home = join(workDir, 'home');
    const projectDir = join(home, 'workspace', project);
    execFileSync('mkdir', ['-p', projectDir]);
    await writeFile(join(projectDir, 'a.txt'), 'hello\n');
    await writeFile(join(projectDir, 'b.txt'), 'world\n');
    execFileSync('bash', ['-c', gitInitScript(project)], { env: { ...process.env, HOME: home } });
    const ls = execFileSync(
      'git',
      ['-C', projectDir, 'ls-tree', '--name-only', 'HEAD'],
    ).toString().split('\n').filter(Boolean).sort();
    expect(ls).toEqual(['a.txt', 'b.txt']);
  });
});
