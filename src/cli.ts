import { Command } from 'commander';
import { runInit } from './commands/init.ts';
import { runSetup } from './commands/setup.ts';
import { runSync } from './commands/sync.ts';
import { runAsk } from './commands/ask.ts';
import { runApply } from './commands/apply.ts';
import { runDoctor } from './commands/doctor.ts';
import { log } from './lib/log.ts';

const VERSION = '0.1.0';

const program = new Command();
program
  .name('remote-claude')
  .description('Local-first dev tool: push your project to a remote Mac Mini, run Claude Code there, and pull back a reviewable unified diff.')
  .version(VERSION);

program
  .command('setup')
  .description('One-shot setup: auto-detect Tailscale peers, generate token, write config')
  .option('-f, --force', 'overwrite existing remote-claude.yml')
  .option('--no-tailscale', 'skip Tailscale auto-detection')
  .option('--host <host>', 'Mac Mini IP/hostname (skips Tailscale picker)')
  .option('--user <user>', 'remote SSH user')
  .option('--project <name>', 'project folder name on remote')
  .option('--path <path>', 'remote project path (use ${project} as placeholder)')
  .option('--ssh-port <n>', 'SSH port', (v: string) => Number(v))
  .option('--agent-port <n>', 'agent HTTP port', (v: string) => Number(v))
  .option('--token <token>', 'bearer token (default: random 32-byte hex)')
  .action(async (opts) => {
    await runSetup(process.cwd(), {
      force: opts.force,
      noTailscale: opts.tailscale === false,
      host: opts.host,
      user: opts.user,
      project: opts.project,
      path: opts.path,
      sshPort: opts.sshPort,
      agentPort: opts.agentPort,
      token: opts.token,
    });
  });

program
  .command('init')
  .description('Minimal config (alias for setup --no-tailscale; rarely needed)')
  .option('-f, --force', 'overwrite existing remote-claude.yml')
  .action(async (opts) => {
    await runInit(process.cwd(), opts);
  });

program
  .command('sync')
  .description('Sync project files to the remote Mac Mini')
  .action(async () => {
    await runSync(process.cwd());
  });

program
  .command('ask')
  .description('Sync, then ask remote Claude — preview and apply the resulting diff')
  .argument('<prompt...>', 'instruction for Claude')
  .option('--no-sync', 'skip sync (use last synced state on remote)')
  .option('--save-only', 'save the patch without prompting to apply')
  .action(async (promptParts: string[], opts: { sync?: boolean; saveOnly?: boolean }) => {
    const prompt = promptParts.join(' ');
    await runAsk(process.cwd(), prompt, {
      skipSync: opts.sync === false,
      saveOnly: opts.saveOnly,
    });
  });

program
  .command('apply')
  .description('Apply a previously saved patch (default: .remote-claude/last.patch)')
  .argument('[patch]', 'path to a patch file')
  .action(async (patch?: string) => {
    await runApply(process.cwd(), patch);
  });

program
  .command('doctor')
  .description('Verify local tools, config, ssh reachability, and agent health')
  .action(async () => {
    await runDoctor(process.cwd());
  });

program.parseAsync(process.argv).catch((err: Error) => {
  log.err(err.message);
  if (process.env.RC_VERBOSE === '1') console.error(err.stack);
  process.exit(1);
});
