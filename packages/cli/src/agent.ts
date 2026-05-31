import { Command } from 'commander';
import { buildServer } from './agent/server.ts';
import { tryDisableKeychainAutoLock } from './agent/keychain.ts';
import { runDaemonInstall, runDaemonUninstall } from './commands/daemon.ts';

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
  const token = envRequired('PW_AGENT_TOKEN');
  const projectsRoot = envRequired('PW_PROJECTS_ROOT');
  const host = process.env.PW_AGENT_HOST ?? '127.0.0.1';
  const port = Number(process.env.PW_AGENT_PORT ?? 7878);
  const aiCommand = process.env.PW_AI_BIN ?? 'claude';
  const aiArgs = (process.env.PW_AI_ARGS ?? '--print').split(/\s+/).filter(Boolean);
  const timeoutSec = Number(process.env.PW_TIMEOUT_SEC ?? 600);

  const app = buildServer({
    token,
    projectsRoot,
    aiCommand,
    aiArgs,
    timeoutSec,
    version: VERSION,
  });

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

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
