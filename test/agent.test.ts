import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildServer } from '../src/agent/server.ts';

const TOKEN = 'abc-test-token-1234567890';

let projectsRoot: string;
let projectDir: string;
let fakeClaudeBin: string;

function git(args: string[], cwd: string) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

async function makeProject(): Promise<void> {
  await mkdir(projectDir, { recursive: true });
  git(['init', '-q', '-b', 'main'], projectDir);
  git(['config', 'user.email', 'test@example.com'], projectDir);
  git(['config', 'user.name', 'Test'], projectDir);
  git(['config', 'commit.gpgsign', 'false'], projectDir);
  await writeFile(join(projectDir, 'a.txt'), 'one\ntwo\nthree\n', 'utf8');
  await writeFile(join(projectDir, 'b.txt'), 'hello\n', 'utf8');
  git(['add', '.'], projectDir);
  git(['commit', '-q', '-m', 'init'], projectDir);
}

/**
 * Write a fake `claude` shell script that mutates the working tree, so we can
 * exercise the diff-capture path without requiring the real Claude CLI.
 */
async function makeFakeClaude(script: string): Promise<string> {
  const path = join(projectsRoot, 'fake-claude.sh');
  await writeFile(path, `#!/bin/sh\nset -eu\n${script}\n`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

beforeEach(async () => {
  projectsRoot = await mkdtemp(join(tmpdir(), 'devbridge-agent-'));
  projectDir = join(projectsRoot, 'sample');
  await makeProject();
});
afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

describe('agent server', () => {
  it('GET /health returns ok without auth', async () => {
    const app = buildServer({
      token: TOKEN,
      projectsRoot,
      claudeCommand: 'definitely-not-installed-xyz',
      claudeArgs: [],
      timeoutSec: 5,
      version: '0.0.0-test',
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; claude: { found: boolean } };
    expect(body.ok).toBe(true);
    expect(body.claude.found).toBe(false);
    await app.close();
  });

  it('rejects /ask without bearer token', async () => {
    const app = buildServer({
      token: TOKEN, projectsRoot, claudeCommand: 'sh', claudeArgs: [], timeoutSec: 5, version: 'x',
    });
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { 'content-type': 'application/json' },
      payload: { prompt: 'p', project: 'sample' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 404 when project directory is missing', async () => {
    const app = buildServer({
      token: TOKEN, projectsRoot, claudeCommand: 'sh', claudeArgs: [], timeoutSec: 5, version: 'x',
    });
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { prompt: 'p', project: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects malicious project names', async () => {
    const app = buildServer({
      token: TOKEN, projectsRoot, claudeCommand: 'sh', claudeArgs: [], timeoutSec: 5, version: 'x',
    });
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { prompt: 'p', project: '../etc/passwd' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('runs claude, captures diff (incl. modifications + new files), and resets working tree', async () => {
    fakeClaudeBin = await makeFakeClaude(
      // Modify a.txt, create c.txt
      `printf 'one\\ntwo\\nthree-edited\\n' > a.txt
printf 'brand new\\n' > c.txt`,
    );

    const app = buildServer({
      token: TOKEN, projectsRoot,
      claudeCommand: fakeClaudeBin, claudeArgs: [],
      timeoutSec: 10, version: 'x',
    });

    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { prompt: 'edit it', project: 'sample' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { diff: string; files: string[]; exitCode: number };
    expect(body.exitCode).toBe(0);
    expect(body.diff).toContain('a.txt');
    expect(body.diff).toContain('three-edited');
    expect(body.diff).toContain('c.txt');
    expect(body.files.sort()).toEqual(['a.txt', 'c.txt']);

    // Working tree must be clean again after the agent runs.
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: projectDir, encoding: 'utf8' });
    expect(status.stdout.trim()).toBe('');
    await app.close();
  });

  it('returns 412 when project is not a git repo', async () => {
    const noGitDir = join(projectsRoot, 'plain');
    await mkdir(noGitDir);
    await writeFile(join(noGitDir, 'x.txt'), 'x', 'utf8');

    const app = buildServer({
      token: TOKEN, projectsRoot, claudeCommand: 'sh', claudeArgs: [], timeoutSec: 5, version: 'x',
    });
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { prompt: 'p', project: 'plain' },
    });
    expect(res.statusCode).toBe(412);
    await app.close();
  });

  it('returns 409 when working tree is dirty before run', async () => {
    await writeFile(join(projectDir, 'a.txt'), 'changed by user\n', 'utf8');

    const app = buildServer({
      token: TOKEN, projectsRoot, claudeCommand: 'sh', claudeArgs: [], timeoutSec: 5, version: 'x',
    });
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { prompt: 'p', project: 'sample' },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
