import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runInit } from '../../src/agent/init.ts';
import * as fs from 'node:fs';
import * as cp from 'node:child_process';

vi.mock('node:child_process');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual };
});

describe('runInit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('clones the repo into RC_PROJECTS_ROOT/<projectName> and returns commit SHA', async () => {
    // Target dir does not exist yet
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(cp, 'spawnSync')
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as unknown as cp.SpawnSyncReturns<string>) // git clone
      .mockReturnValueOnce({ status: 0, stdout: 'abcdef1234\n', stderr: '' } as unknown as cp.SpawnSyncReturns<string>); // git rev-parse HEAD

    const res = await runInit({
      projectsRoot: '/tmp/projects',
      gitUrl: 'git@github.com:co/app.git',
      branch: 'main',
      projectName: 'app',
    });
    expect(res).toEqual({ ok: true, sha: 'abcdef1234', path: '/tmp/projects/app' });
  });

  it('refuses when target directory already exists and is non-empty', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['something'] as unknown as ReturnType<typeof fs.readdirSync>);

    const res = await runInit({
      projectsRoot: '/tmp/projects',
      gitUrl: 'git@github.com:co/app.git',
      branch: 'main',
      projectName: 'app',
    });
    expect(res).toMatchObject({ ok: false, code: 'target_exists' });
  });
});
