import { Command } from 'commander';
import { runInit } from './commands/init.ts';
import { runSync } from './commands/sync.ts';
import { runAsk } from './commands/ask.ts';
import { runApply } from './commands/apply.ts';
import { runDoctor } from './commands/doctor.ts';
import { log } from './lib/log.ts';

const VERSION = '0.1.0';

const program = new Command();
program
  .name('devbridge')
  .description('Local-first dev tool: push project to remote Mac Mini, run Claude Code there, return a reviewable diff.')
  .version(VERSION);

program
  .command('init')
  .description('Create devbridge.yml in the current project')
  .option('-f, --force', 'overwrite existing devbridge.yml')
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
  .description('Apply a previously saved patch (default: .devbridge/last.patch)')
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
  if (process.env.DEVBRIDGE_VERBOSE === '1') console.error(err.stack);
  process.exit(1);
});
