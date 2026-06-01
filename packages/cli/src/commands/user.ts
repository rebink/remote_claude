import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { UsersStore } from '../agent/users-store.ts';
import { generateToken } from '../agent/token.ts';

function usersJsonPath(): string {
  return process.env.PW_USERS_FILE ?? join(homedir(), '.patchwire', 'users.json');
}

function openStore(): UsersStore {
  return new UsersStore(usersJsonPath());
}

function printToken(user: string, token: string): void {
  process.stdout.write(
    `Created user: ${user}\n` +
      `Token (save this — it will not be shown again):\n  ${token}\n\n` +
      `To register on the laptop, add to ~/.patchwire/env:\n` +
      `  PW_TOKEN=${token}\n`,
  );
}

export function registerUserCommands(program: Command): void {
  const user = program.command('user').description('Manage agent users (multi-developer mode)');

  user
    .command('add <name>')
    .description('Create a new user; prints the generated token once.')
    .option('--token <value>', 'use a caller-supplied token instead of generating one')
    .action((name: string, opts: { token?: string }) => {
      const token = opts.token ?? generateToken();
      const store = openStore();
      store.addUser(name, token);
      printToken(name, token);
    });

  user
    .command('list')
    .description('List all users with their status.')
    .action(() => {
      const store = openStore();
      const rows = store.list();
      if (rows.length === 0) {
        process.stdout.write('(no users)\n');
        return;
      }
      const lines = rows.map((u) => {
        const status = u.disabled ? 'disabled' : 'active';
        const seen = u.lastSeen ?? 'never';
        return `${u.user}\t${status}\tcreated=${u.createdAt}\tlast_seen=${seen}`;
      });
      process.stdout.write(lines.join('\n') + '\n');
    });

  user
    .command('disable <name>')
    .description('Disable a user (token continues to resolve but every request 403s).')
    .action((name: string) => {
      openStore().disable(name);
      process.stdout.write(`Disabled user: ${name}\n`);
    });

  user
    .command('enable <name>')
    .description('Re-enable a previously disabled user.')
    .action((name: string) => {
      openStore().enable(name);
      process.stdout.write(`Enabled user: ${name}\n`);
    });

  user
    .command('rm <name>')
    .description('Permanently remove a user. Their token stops working immediately.')
    .action((name: string) => {
      openStore().remove(name);
      process.stdout.write(`Removed user: ${name}\n`);
    });

  user
    .command('rotate <name>')
    .description("Generate a new token for an existing user; old token dies immediately.")
    .option('--token <value>', 'use a caller-supplied token instead of generating one')
    .action((name: string, opts: { token?: string }) => {
      const token = opts.token ?? generateToken();
      openStore().rotate(name, token);
      process.stdout.write(
        `Rotated token for ${name}\n` +
          `New token (save it):\n  ${token}\n`,
      );
    });
}
