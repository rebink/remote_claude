import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerUserCommands } from '../../src/commands/user.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('patchwire-agent user policy', () => {
  let dir: string; let usersPath: string; let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-userpol-cmd-'));
    usersPath = join(dir, 'users.json');
    process.env.PW_USERS_FILE = usersPath;
    new UsersStore(usersPath).addUser('ana', 'tok');
    logs = [];
    logSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { logs.push(String(c)); return true; });
  });
  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.PW_USERS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  function run(argv: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerUserCommands(program);
    return program.parseAsync(['node', 'patchwire-agent', ...argv]);
  }

  it('projects sets an allowlist', async () => {
    await run(['user', 'policy', 'projects', 'ana', 'app', 'api']);
    expect(new UsersStore(usersPath).getPolicy('ana').projects).toEqual(['app', 'api']);
  });

  it('projects --clear removes the allowlist', async () => {
    await run(['user', 'policy', 'projects', 'ana', 'app']);
    await run(['user', 'policy', 'projects', 'ana', '--clear']);
    expect(new UsersStore(usersPath).getPolicy('ana').projects).toBeUndefined();
  });

  it('rate sets a rate limit parsed from a duration', async () => {
    await run(['user', 'policy', 'rate', 'ana', '50', '1h']);
    expect(new UsersStore(usersPath).getPolicy('ana').rateLimit).toEqual({ max: 50, windowMs: 3600_000 });
  });

  it('rate --clear removes the rate limit', async () => {
    await run(['user', 'policy', 'rate', 'ana', '5', '1h']);
    await run(['user', 'policy', 'rate', 'ana', '--clear']);
    expect(new UsersStore(usersPath).getPolicy('ana').rateLimit).toBeUndefined();
  });

  it('rate rejects a non-positive max', async () => {
    await expect(run(['user', 'policy', 'rate', 'ana', '0', '1h'])).rejects.toThrow();
  });

  it('show prints the current policy', async () => {
    await run(['user', 'policy', 'projects', 'ana', 'app']);
    logs.length = 0;
    await run(['user', 'policy', 'show', 'ana']);
    const out = logs.join('');
    expect(out).toMatch(/app/);
    expect(out).toMatch(/ana/);
  });
});
