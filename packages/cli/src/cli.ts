import { Command } from 'commander';
import { runInit } from './commands/init.ts';
import { runSetup } from './commands/setup.ts';
import { runSync } from './commands/sync.ts';
import { runAsk } from './commands/ask.ts';
import { runApply } from './commands/apply.ts';
import { runPush } from './commands/push.ts';
import { runDoctor } from './commands/doctor.ts';
import { log } from './lib/log.ts';
import { VERSION } from './version.ts';

const program = new Command();
program
  .name('patchwire')
  .description('Local-first dev tool: push your project to a remote Mac Mini, run Claude Code there, and pull back a reviewable unified diff.')
  .version(VERSION);

program
  .command('setup')
  .description('One-shot setup: auto-detect Tailscale peers, generate token, write config')
  .option('-f, --force', 'overwrite existing patchwire.yml')
  .option('--no-tailscale', 'skip Tailscale auto-detection')
  .option('--host <host>', 'Mac Mini IP/hostname (skips Tailscale picker)')
  .option('--user <user>', 'remote SSH user')
  .option('--project <name>', 'project folder name on remote')
  .option('--path <path>', 'remote project path (use ${project} as placeholder)')
  .option('--ssh-port <n>', 'SSH port', (v: string) => Number(v))
  .option('--agent-port <n>', 'agent HTTP port', (v: string) => Number(v))
  .option('--token <token>', 'bearer token (default: random 32-byte hex)')
  .option('--username <name>', "the agent's name for you (default: os.userInfo().username)")
  .option('--list-peers', 'print Tailscale peers and exit')
  .option('--json', 'machine-readable output (for --list-peers)')
  .option('--key-path <path>', 'private key path for the per-project key', '')
  .option('--verify-key', 'check that key-based SSH works (used by the wizard)')
  .action(async (opts) => {
    if (opts.listPeers) {
      const { runSetupListPeers } = await import('./commands/setup.ts');
      await runSetupListPeers({ json: !!opts.json });
      return;
    }
    if (opts.verifyKey) {
      const { runVerifyKey } = await import('./commands/setup.ts');
      runVerifyKey({
        host: opts.host,
        user: opts.user,
        port: opts.sshPort ?? 22,
        keyPath: opts.keyPath,
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
      username: opts.username,
    });
  });

program
  .command('init')
  .description('Minimal config (alias for setup --no-tailscale; rarely needed)')
  .option('-f, --force', 'overwrite existing patchwire.yml')
  .action(async (opts) => {
    await runInit(process.cwd(), opts);
  });

program
  .command('init-remote')
  .description('Bootstrap a project on the remote Mac Mini by pushing the local working directory')
  .requiredOption('--from-local', 'push the current working directory (the only supported mode)')
  .requiredOption('--project <name>', 'project directory name on the remote ([a-zA-Z0-9._-]+)')
  .option('--host <host>', 'override host from patchwire.yml')
  .option('--user <user>', 'override user from patchwire.yml')
  .option('--ssh-port <n>', 'override SSH port', (v) => Number(v))
  .option('--key-path <path>', 'per-project SSH key (default: ~/.patchwire/keys/<host>-<user>)')
  .option('--remote-path <path>', 'override remote project path (default: ~/workspace/<project>)')
  .option('--overwrite', 'if the remote path exists, rm -rf it first', false)
  .option('--use-existing', 'if the remote path exists, skip mkdir + rsync (config-only bootstrap)', false)
  .option('--json', 'machine-readable progress stream (used by the extension wizard)', false)
  .action(async (opts: {
    fromLocal: boolean;
    project: string;
    host?: string;
    user?: string;
    sshPort?: number;
    keyPath?: string;
    remotePath?: string;
    overwrite?: boolean;
    useExisting?: boolean;
    json?: boolean;
  }) => {
    const { runInitRemote } = await import('./commands/init-remote.ts');
    const r = await runInitRemote({
      fromLocal: true,
      project: opts.project,
      host: opts.host,
      user: opts.user,
      sshPort: opts.sshPort,
      keyPath: opts.keyPath,
      remotePath: opts.remotePath,
      overwrite: opts.overwrite,
      useExisting: opts.useExisting,
      json: opts.json,
    });
    if (!r.ok) {
      const exitMap: Record<string, number> = {
        invalid_project_name: 2,
        missing_config: 3,
        missing_key: 3,
        target_exists: 4,
        wipe_failed: 5,
        mkdir_failed: 5,
        rsync_failed: 5,
        ssh_unreachable: 5,
        ssh_auth_failed: 5,
        ssh_error: 5,
        git_init_failed: 5,
        unsafe_state: 6,
        unknown_error: 1,
      };
      process.exit(exitMap[r.code] ?? 1);
    }
  });

program
  .command('sync')
  .description('Sync project files to the remote Mac Mini')
  .option('--json', 'JSONL output (for the VS Code extension)')
  .option('--force', 'sync even if the secret scan (secretScan: block) finds secrets')
  .action(async (opts: { json?: boolean; force?: boolean }) => {
    await runSync(process.cwd(), { json: !!opts.json, force: !!opts.force });
  });

program
  .command('ask')
  .description('Sync, then ask Patchwire — preview and apply the resulting diff')
  .argument('<prompt...>', 'instruction for Claude')
  .option('--no-sync', 'skip sync (use last synced state on remote)')
  .option('--save-only', 'save the patch without prompting to apply')
  .option('--force', 'sync even if the secret scan (secretScan: block) finds secrets')
  .action(async (promptParts: string[], opts: { sync?: boolean; saveOnly?: boolean; force?: boolean }) => {
    const prompt = promptParts.join(' ');
    await runAsk(process.cwd(), prompt, {
      skipSync: opts.sync === false,
      saveOnly: opts.saveOnly,
      force: opts.force,
    });
  });

program
  .command('apply')
  .description('Apply a previously saved patch (default: .patchwire/last.patch)')
  .argument('[patch]', 'path to a patch file')
  .action(async (patch?: string) => {
    await runApply(process.cwd(), patch);
  });

program
  .command('push')
  .description('Copy a local file to the remote so the SSH claude session can read it')
  .argument('[files...]', 'local file path(s) to push')
  .option('--stage-only', 'stage into .patchwire-inbox/ but skip rsync (transfer handled externally, e.g. Mutagen)')
  .option('--json', 'emit {"remotePath":…} as JSON')
  .option('--clip', 'push the current clipboard image (screenshot)')
  .option('--clean', 'clear the local (and remote) attachments inbox')
  .action(async (files: string[], opts: { stageOnly?: boolean; json?: boolean; clip?: boolean; clean?: boolean }) => {
    await runPush(process.cwd(), files ?? [], {
      stageOnly: opts.stageOnly,
      json: opts.json,
      clip: opts.clip,
      clean: opts.clean,
    });
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

program
  .command('whoami')
  .description('Show which user the agent recognizes you as')
  .action(async () => {
    const { runWhoami } = await import('./commands/whoami.ts');
    await runWhoami(process.cwd());
  });

program.parseAsync(process.argv).catch((err: Error) => {
  log.err(err.message);
  if (process.env.PW_VERBOSE === '1') console.error(err.stack);
  process.exit(1);
});
