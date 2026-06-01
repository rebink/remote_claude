import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './agent/server.ts';
import { UsersStore } from './agent/users-store.ts';
import { migrateIfNeeded } from './agent/migrate-v01.ts';
import { migrateProjectsToDefault } from './agent/migrate-projects.ts';
import { tryDisableKeychainAutoLock } from './agent/keychain.ts';
import { runDaemonInstall, runDaemonUninstall } from './commands/daemon.ts';
import { registerUserCommands } from './commands/user.ts';

const VERSION = '0.1.0';

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function runServe(): Promise<void> {
  const projectsRoot = envRequired('PW_PROJECTS_ROOT');
  const host = process.env.PW_AGENT_HOST ?? '127.0.0.1';
  const port = Number(process.env.PW_AGENT_PORT ?? 7878);
  const aiCommand = process.env.PW_AI_BIN ?? 'claude';
  const aiArgs = (process.env.PW_AI_ARGS ?? '--print').split(/\s+/).filter(Boolean);
  const timeoutSec = Number(process.env.PW_TIMEOUT_SEC ?? 600);

  const usersJsonPath = process.env.PW_USERS_FILE ?? join(homedir(), '.patchwire', 'users.json');
  const legacyToken = process.env.PW_AGENT_TOKEN;

  const migration = migrateIfNeeded({ usersJsonPath, legacyToken });
  const usersStore = new UsersStore(usersJsonPath);

  const app = buildServer({
    usersStore,
    projectsRoot,
    aiCommand,
    aiArgs,
    timeoutSec,
    version: VERSION,
  });

  if (migration.migrated) {
    try {
      const projectsMigration = migrateProjectsToDefault({ projectsRoot });
      app.log.info(
        `migrated v0.1 → v0.2: created 'default' user from PW_AGENT_TOKEN, ` +
          `moved ${projectsMigration.moved.length} project(s) into ${projectsRoot}/default/`,
      );
      if (projectsMigration.moved.length > 0) {
        app.log.info(`moved projects: ${projectsMigration.moved.join(', ')}`);
      }
    } catch (err) {
      // A migration conflict (e.g., PROJECTS_ROOT/default/<name> already exists)
      // must not silently corrupt state. Surface a clear error and refuse to start
      // so the operator can resolve the collision by hand before retrying.
      app.log.error(`v0.1 → v0.2 project migration failed: ${(err as Error).message}`);
      app.log.error(`refusing to start; resolve the conflict manually and rerun`);
      process.exit(1);
    }
  }
  if (usersStore.list().length === 0) {
    app.log.warn(
      'no users registered — agent will 401 every request. ' +
      'Run: patchwire-agent user add <name>',
    );
  }

  // Best-effort: keep the macOS login keychain from auto-locking so `claude`
  // can read its OAuth credentials. Only takes effect if the keychain is
  // currently unlocked (e.g., admin just logged in or SSH'd). No-op on
  // non-macOS. Failures are non-fatal — chat turns surface a clearer error
  // if claude still hits "Not logged in" later.
  const kc = tryDisableKeychainAutoLock();
  if (kc.ok && process.platform === 'darwin') {
    app.log.info('login keychain auto-lock disabled');
  } else if (!kc.ok) {
    app.log.warn(`could not adjust login keychain settings: ${kc.reason ?? 'unknown'}`);
  }

  try {
    const addr = await app.listen({ host, port });
    app.log.info(`patchwire-agent listening on ${addr}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const program = new Command();
program
  .name('patchwire-agent')
  .description('Patchwire HTTP agent — runs `claude` on a remote machine and returns diffs.')
  .version(VERSION);

program
  .command('serve', { isDefault: true })
  .description('Start the HTTP server (default)')
  .action(async () => { await runServe(); });

program
  .command('install')
  .description('Install as a launchd LaunchAgent so it starts on login (macOS)')
  .option('--projects-root <path>', 'override PW_PROJECTS_ROOT')
  .option('--port <n>', 'override PW_AGENT_PORT', (v: string) => Number(v))
  .option('--host <h>', 'override PW_AGENT_HOST')
  .option('--token <t>', 'override PW_AGENT_TOKEN')
  .option('--ai-bin <path>', 'override PW_AI_BIN')
  .action(async (opts) => { await runDaemonInstall(opts); });

program
  .command('uninstall')
  .description('Remove the launchd LaunchAgent')
  .action(async () => { await runDaemonUninstall(); });

registerUserCommands(program);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
