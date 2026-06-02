import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { UsersStore } from '../agent/users-store.ts';
import { generateToken } from '../agent/token.ts';
import { parseDurationMs } from '../lib/duration.ts';
import { humanizeMs } from '../agent/usage.ts';

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

  const policy = user
    .command('policy')
    .description('View or set per-user policy (project allowlist, rate limit)');

  policy
    .command('show <name>')
    .description("Show a user's policy.")
    .action((name: string) => {
      const p = openStore().getPolicy(name);
      const projects = p.projects && p.projects.length ? p.projects.join(', ') : '(all allowed)';
      const rate = p.rateLimit ? `${p.rateLimit.max} per ${humanizeMs(p.rateLimit.windowMs)}` : '(unlimited)';
      process.stdout.write(`Policy for ${name}:\n  projects: ${projects}\n  rate limit: ${rate}\n`);
    });

  policy
    .command('projects <name> [projects...]')
    .description('Set the project allowlist (pass --clear, or no projects, to allow all).')
    .option('--clear', 'remove the allowlist (allow all projects)')
    .action((name: string, projects: string[], opts: { clear?: boolean }) => {
      const store = openStore();
      if (opts.clear || projects.length === 0) {
        store.setProjects(name, null);
        process.stdout.write(`Cleared project allowlist for ${name} (all projects allowed)\n`);
      } else {
        store.setProjects(name, projects);
        process.stdout.write(`Set project allowlist for ${name}: ${projects.join(', ')}\n`);
      }
    });

  policy
    .command('rate <name> [max] [window]')
    .description("Set a rate limit, e.g. 'rate ana 50 1h'. Pass --clear to remove.")
    .option('--clear', 'remove the rate limit')
    .action((name: string, max: string | undefined, window: string | undefined, opts: { clear?: boolean }) => {
      const store = openStore();
      if (opts.clear) {
        store.setRateLimit(name, null);
        process.stdout.write(`Cleared rate limit for ${name}\n`);
        return;
      }
      if (!max || !window) {
        throw new Error("usage: user policy rate <name> <max> <window>  (e.g. 'rate ana 50 1h')");
      }
      const maxN = Number(max);
      if (!Number.isInteger(maxN) || maxN < 1) {
        throw new Error(`max must be a positive integer (got '${max}')`);
      }
      const windowMs = parseDurationMs(window);
      store.setRateLimit(name, { max: maxN, windowMs });
      process.stdout.write(`Set rate limit for ${name}: ${maxN} requests per ${window}\n`);
    });
}
