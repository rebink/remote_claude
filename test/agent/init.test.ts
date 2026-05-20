import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runInit } from '../../src/agent/init.ts';
import { InitBody, buildServer } from '../../src/agent/server.ts';
import * as initMod from '../../src/agent/init.ts';
import * as fs from 'node:fs';
import * as cp from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    const spawn = vi.spyOn(cp, 'spawnSync')
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as unknown as cp.SpawnSyncReturns<string>) // git clone
      .mockReturnValueOnce({ status: 0, stdout: 'abcdef1234\n', stderr: '' } as unknown as cp.SpawnSyncReturns<string>); // git rev-parse HEAD

    const res = await runInit({
      projectsRoot: '/tmp/projects',
      gitUrl: 'git@github.com:co/app.git',
      branch: 'main',
      projectName: 'app',
    });
    expect(res).toEqual({ ok: true, sha: 'abcdef1234', path: '/tmp/projects/app' });
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'git',
      ['clone', '-b', 'main', '--', 'git@github.com:co/app.git', '/tmp/projects/app'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
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

describe('InitBody validation (path traversal)', () => {
  it('rejects projectName containing path separators', () => {
    expect(InitBody.safeParse({ gitUrl: 'x', projectName: '../etc' }).success).toBe(false);
    expect(InitBody.safeParse({ gitUrl: 'x', projectName: 'a/b' }).success).toBe(false);
    expect(InitBody.safeParse({ gitUrl: 'x', projectName: 'normal-name_1.0' }).success).toBe(true);
  });

  it('rejects branch names with leading hyphens or whitespace', () => {
    expect(InitBody.safeParse({ gitUrl: 'x', projectName: 'p', branch: '-x' }).success).toBe(false);
    expect(InitBody.safeParse({ gitUrl: 'x', projectName: 'p', branch: ' evil ' }).success).toBe(false);
    expect(InitBody.safeParse({ gitUrl: 'x', projectName: 'p', branch: 'feat/foo-bar.v1.0' }).success).toBe(true);
    expect(InitBody.safeParse({ gitUrl: 'x', projectName: 'p' }).success).toBe(true);
  });
});

describe('POST /init HTTP status mapping', () => {
  function makeApp() {
    const dir = mkdtempSync(join(tmpdir(), 'rc-init-http-'));
    return buildServer({
      token: 't',
      projectsRoot: dir,
      claudeCommand: 'claude',
      claudeArgs: [],
      timeoutSec: 60,
      version: 'test',
      sessionStorePath: join(dir, 'sessions.json'),
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 409 when result.code === "target_exists"', async () => {
    vi.spyOn(initMod, 'runInit').mockResolvedValue({
      ok: false,
      code: 'target_exists',
      stderr: 'not empty',
    });
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/init',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      payload: { gitUrl: 'git@example.com:x.git', projectName: 'p' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 500 when result.code === "clone_failed"', async () => {
    vi.spyOn(initMod, 'runInit').mockResolvedValue({
      ok: false,
      code: 'clone_failed',
      stderr: 'network down',
    });
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/init',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      payload: { gitUrl: 'git@example.com:x.git', projectName: 'p' },
    });
    expect(res.statusCode).toBe(500);
  });

  it('returns 500 when result.code === "rev_parse_failed"', async () => {
    vi.spyOn(initMod, 'runInit').mockResolvedValue({
      ok: false,
      code: 'rev_parse_failed',
      stderr: 'no HEAD',
    });
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/init',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      payload: { gitUrl: 'git@example.com:x.git', projectName: 'p' },
    });
    expect(res.statusCode).toBe(500);
  });
});
