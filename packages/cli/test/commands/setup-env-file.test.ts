import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from '../../src/commands/setup.ts';

describe('runSetup writes ~/.patchwire/env with PW_USER + PW_TOKEN', () => {
  let cwd: string;
  let homeBackup: string | undefined;
  let fakeHome: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'pw-setup-env-'));
    fakeHome = mkdtempSync(join(tmpdir(), 'pw-fakehome-'));
    homeBackup = process.env.HOME;
    process.env.HOME = fakeHome;
  });
  afterEach(() => {
    if (homeBackup === undefined) delete process.env.HOME;
    else process.env.HOME = homeBackup;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('writes both PW_TOKEN and PW_USER lines', async () => {
    await runSetup(cwd, {
      noTailscale: true,
      host: '127.0.0.1',
      user: 'me',
      project: 'demo',
      path: '/tmp/demo',
      sshPort: 22,
      agentPort: 7878,
      token: 'test-token-1234',
      username: 'alice',
    });
    const envPath = join(fakeHome, '.patchwire', 'env');
    expect(existsSync(envPath)).toBe(true);
    const content = readFileSync(envPath, 'utf8');
    expect(content).toMatch(/^export PW_TOKEN=test-token-1234\b/m);
    expect(content).toMatch(/^export PW_USER=alice\b/m);
  });
});
