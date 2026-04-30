import { loadConfig } from '../lib/config.ts';
import { rsyncPush } from '../lib/rsync.ts';
import { AgentClient } from '../lib/client.ts';
import { applyPatchInteractive, savePatch } from '../lib/patch.ts';
import { log } from '../lib/log.ts';

export interface AskOptions {
  skipSync?: boolean;
  saveOnly?: boolean;
}

export async function runAsk(cwd: string, prompt: string, opts: AskOptions = {}): Promise<void> {
  if (!prompt.trim()) {
    log.err('Prompt is empty.');
    process.exitCode = 1;
    return;
  }
  const cfg = await loadConfig(cwd);

  if (!opts.skipSync) {
    log.step('Syncing project to remote…');
    const r = await rsyncPush(cfg, cwd);
    log.ok(`Synced in ${r.durationMs}ms`);
  } else {
    log.dim('Skipping sync.');
  }

  const client = new AgentClient(cfg);
  log.step('Asking remote Claude…');
  const askStart = Date.now();
  const res = await client.ask({ prompt, project: cfg.project });
  log.ok(`Remote run finished in ${res.durationMs}ms (CLI total ${Date.now() - askStart}ms)`);

  if (res.exitCode !== 0) {
    log.warn(`Claude exited with code ${res.exitCode}`);
    if (res.stderr.trim()) log.dim(res.stderr.trim());
  }

  if (!res.diff.trim()) {
    log.warn('No changes were produced.');
    if (res.stdout.trim()) {
      log.step('Claude stdout:');
      console.log(res.stdout);
    }
    return;
  }

  if (opts.saveOnly) {
    const path = await savePatch(res.diff, cwd);
    log.ok(`Saved patch to ${path}`);
    return;
  }

  await applyPatchInteractive(res.diff, cwd);
}
