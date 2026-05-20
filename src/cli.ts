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
  .option('--list-peers', 'print Tailscale peers and exit')
  .option('--json', 'machine-readable output (for --list-peers)')
  .option('--password-stdin', 'read SSH password from stdin and run ssh-copy-id (used by the wizard)')
  .option('--key-path <path>', 'private key path for the per-project key', '')
  .option('--trust-new-key', 'rewrite known_hosts before attempting (used after a fingerprint mismatch confirmation)')
  .action(async (opts) => {
    if (opts.listPeers) {
      const { runSetupListPeers } = await import('./commands/setup.ts');
      await runSetupListPeers({ json: !!opts.json });
      return;
    }
    if (opts.passwordStdin) {
      const { runSetupPasswordStdin } = await import('./commands/setup.ts');
      await runSetupPasswordStdin({
        host: opts.host,
        user: opts.user,
        port: opts.sshPort ?? 22,
        keyPath: opts.keyPath,
        trustNewKey: !!opts.trustNewKey,
      });
      return;
    }
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
  .command('init-remote')
  .description('Clone the project on the remote Mac Mini (called by the wizard)')
  .requiredOption('--git-url <url>', 'git URL to clone')
  .option('--branch <branch>', 'branch to clone', 'main')
  .requiredOption('--project <name>', 'project directory name on the remote')
  .action(async (opts: { gitUrl: string; branch: string; project: string }) => {
    const { runInitRemote } = await import('./commands/init-remote.ts');
    await runInitRemote({ gitUrl: opts.gitUrl, branch: opts.branch, project: opts.project });
  });

program
  .command('sync')
  .description('Sync project files to the remote Mac Mini')
  .option('--json', 'JSONL output (for the VS Code extension)')
  .action(async (opts: { json?: boolean }) => {
    await runSync(process.cwd(), { json: !!opts.json });
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
  .command('chat')
  .description('Multi-turn chat with Claude on the remote (used by the VS Code extension)')
  .argument('<prompt...>', 'prompt text')
  .requiredOption('--session <uuid>', 'extension-side session UUID')
  .option('--json', 'JSONL output (default in this command)', true)
  .option('--no-sync', 'skip pre-sync')
  .action(async (promptParts: string[], opts: { session: string; sync?: boolean }) => {
    const { runChat } = await import('./commands/chat.ts');
    await runChat({
      cwd: process.cwd(),
      prompt: promptParts.join(' '),
      sessionUuid: opts.session,
      skipSync: opts.sync === false,
    });
  });

program
  .command('delete-session')
  .description('Remove a chat session from the agent (used by the extension)')
  .requiredOption('--session <uuid>', 'extension UUID to remove')
  .action(async (opts: { session: string }) => {
    const { loadConfig } = await import('./lib/config.ts');
    const { agentRequest } = await import('./lib/client.ts');
    const cfg = await loadConfig(process.cwd());
    await agentRequest(cfg, 'DELETE', `/session/${encodeURIComponent(opts.session)}`);
  });

program
  .command('session-status')
  .description('Get the in-memory status of a chat session on the agent')
  .requiredOption('--session <uuid>', 'extension UUID to check')
  .action(async (opts: { session: string }) => {
    const { loadConfig } = await import('./lib/config.ts');
    const { agentRequest } = await import('./lib/client.ts');
    const cfg = await loadConfig(process.cwd());
    const out = await agentRequest<unknown>(cfg, 'GET', `/session/${encodeURIComponent(opts.session)}/status`);
    process.stdout.write(JSON.stringify(out));
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
