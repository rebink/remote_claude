import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerUserCommands } from '../../src/commands/user.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('patchwire-agent user', () => {
  let dir: string;
  let usersJson: string;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-user-cmd-'));
    usersJson = join(dir, 'users.json');
    process.env.PW_USERS_FILE = usersJson;
    logs = [];
    logSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.PW_USERS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  function run(argv: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride(); // throw instead of process.exit on errors
    registerUserCommands(program);
    return program.parseAsync(['node', 'patchwire-agent', ...argv]);
  }

  it('add creates a user and prints the token once', async () => {
    await run(['user', 'add', 'alice']);
    const out = logs.join('');
    expect(out).toMatch(/Created user: alice/);
    expect(out).toMatch(/[0-9a-f]{64}/);
    const store = new UsersStore(usersJson);
    expect(store.list().map((u) => u.user)).toEqual(['alice']);
  });

  it('add --token uses a caller-supplied token', async () => {
    await run(['user', 'add', 'alice', '--token', 'my-explicit-token']);
    const store = new UsersStore(usersJson);
    expect(store.lookupByToken('my-explicit-token')).toEqual({ user: 'alice', disabled: false });
  });

  it('list prints all users with status', async () => {
    await run(['user', 'add', 'alice']);
    logs.length = 0;
    await run(['user', 'add', 'bob']);
    logs.length = 0;
    await run(['user', 'disable', 'bob']);
    logs.length = 0;
    await run(['user', 'list']);
    const out = logs.join('');
    expect(out).toMatch(/alice.*active/i);
    expect(out).toMatch(/bob.*disabled/i);
  });

  it('disable then enable toggles status', async () => {
    await run(['user', 'add', 'alice']);
    await run(['user', 'disable', 'alice']);
    let store = new UsersStore(usersJson);
    expect(store.list()[0].disabled).toBe(true);
    await run(['user', 'enable', 'alice']);
    store = new UsersStore(usersJson);
    expect(store.list()[0].disabled).toBe(false);
  });

  it('rm drops the user', async () => {
    await run(['user', 'add', 'alice']);
    await run(['user', 'rm', 'alice']);
    const store = new UsersStore(usersJson);
    expect(store.list()).toEqual([]);
  });

  it('rotate replaces the token and prints the new one', async () => {
    await run(['user', 'add', 'alice', '--token', 'old-tok']);
    logs.length = 0;
    await run(['user', 'rotate', 'alice']);
    const out = logs.join('');
    expect(out).toMatch(/Rotated token for alice/);
    expect(out).toMatch(/[0-9a-f]{64}/);
    const store = new UsersStore(usersJson);
    expect(store.lookupByToken('old-tok')).toBeNull();
  });

  it('add rejects an existing username with a useful error', async () => {
    await run(['user', 'add', 'alice']);
    await expect(run(['user', 'add', 'alice'])).rejects.toThrow(/already exists/);
  });
});
