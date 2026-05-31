/**
 * End-to-end bootstrap test against localhost.
 *
 * REQUIRES:
 *   - `ssh user@127.0.0.1` works without a password prompt (pubkey installed in
 *     ~/.ssh/authorized_keys for the test user).
 *   - `PW_E2E=1` set in env.
 *   - Test user is the one running the test (or override with E2E_USER).
 *
 * Run:
 *   PW_E2E=1 pnpm test test/integration/bootstrap.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInitRemote } from '../../src/commands/init-remote.ts';

const ENABLED = process.env.PW_E2E === '1';
const E2E_USER = process.env.E2E_USER ?? userInfo().username;

let projectDir: string;
let homeRemote: string;
let projectName: string;

beforeAll(async () => {
  if (!ENABLED) return;
  projectDir = await mkdtemp(join(tmpdir(), 'e2e-proj-'));
  await writeFile(join(projectDir, 'README.md'), '# test\n');
  await writeFile(join(projectDir, 'src.ts'), 'export const x = 1;\n');

  // The CLI hard-codes ~/workspace/<project>; we let it use the real $HOME.
  homeRemote = homedir();
  projectName = `e2e-${Date.now()}`;
});

afterAll(async () => {
  if (!ENABLED) return;
  await rm(projectDir, { recursive: true, force: true });
  await rm(join(homeRemote, 'workspace', projectName), { recursive: true, force: true });
});

describe.skipIf(!ENABLED)('bootstrap e2e (localhost)', () => {
  it('bootstraps a populated project and leaves no git remotes', async () => {
    // The CLI needs a key at ~/.patchwire/keys/127.0.0.1-<user> for default path resolution.
    // We point it at ~/.ssh/id_rsa or id_ed25519 via --key-path instead.
    const keyPath = process.env.E2E_KEY_PATH ?? join(homedir(), '.ssh', 'id_rsa');
    const r = await runInitRemote({
      fromLocal: true,
      project: projectName,
      host: '127.0.0.1',
      user: E2E_USER,
      sshPort: 22,
      keyPath,
      localPath: projectDir,
    });
    expect(r).toMatchObject({ ok: true, projectName, remotePath: `~/workspace/${projectName}` });

    const remoteProj = join(homeRemote, 'workspace', projectName);
    const remotes = execFileSync('git', ['-C', remoteProj, 'remote', '-v']).toString().trim();
    expect(remotes).toBe('');

    const log = execFileSync('git', ['-C', remoteProj, 'log', '--oneline']).toString().trim();
    expect(log).toMatch(/snapshot from laptop/);

    const author = execFileSync(
      'git',
      ['-C', remoteProj, 'log', '-1', '--format=%ae %an'],
    ).toString().trim();
    expect(author).toBe('patchwire@local Patchwire (sandbox)');
  });
});
