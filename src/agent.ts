import { Command } from 'commander';
import { buildServer } from './agent/server.ts';
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
  const token = envRequired('RC_AGENT_TOKEN');
  const projectsRoot = envRequired('RC_PROJECTS_ROOT');
  const host = process.env.RC_AGENT_HOST ?? '127.0.0.1';
  const port = Number(process.env.RC_AGENT_PORT ?? 7878);
  const claudeCommand = process.env.RC_CLAUDE_BIN ?? 'claude';
  const claudeArgs = (process.env.RC_CLAUDE_ARGS ?? '--print').split(/\s+/).filter(Boolean);
  const timeoutSec = Number(process.env.RC_TIMEOUT_SEC ?? 600);

  const app = buildServer({
    token,
    projectsRoot,
    claudeCommand,
    claudeArgs,
    timeoutSec,
    version: VERSION,
  });

  try {
    const addr = await app.listen({ host, port });
    app.log.info(`remote-claude-agent listening on ${addr}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const program = new Command();
program
  .name('remote-claude-agent')
  .description('Remote Claude HTTP agent — runs `claude` on a remote machine and returns diffs.')
  .version(VERSION);

program
  .command('serve', { isDefault: true })
  .description('Start the HTTP server (default)')
  .action(async () => { await runServe(); });

program
  .command('install')
  .description('Install as a launchd LaunchAgent so it starts on login (macOS)')
  .option('--projects-root <path>', 'override RC_PROJECTS_ROOT')
  .option('--port <n>', 'override RC_AGENT_PORT', (v: string) => Number(v))
  .option('--host <h>', 'override RC_AGENT_HOST')
  .option('--token <t>', 'override RC_AGENT_TOKEN')
  .option('--claude-bin <path>', 'override RC_CLAUDE_BIN')
  .action(async (opts) => { await runDaemonInstall(opts); });

program
  .command('uninstall')
  .description('Remove the launchd LaunchAgent')
  .action(async () => { await runDaemonUninstall(); });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
