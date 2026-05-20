import { loadConfig } from '../lib/config.ts';
import * as rsync from '../lib/rsync.ts';
import { log } from '../lib/log.ts';

export interface SyncOpts {
  json?: boolean;
}

export async function runSync(cwd: string, opts: SyncOpts = {}): Promise<void> {
  const cfg = await loadConfig(cwd);

  if (opts.json) {
    const emit = (e: unknown): void => {
      process.stdout.write(JSON.stringify(e) + '\n');
    };
    emit({ type: 'sync_start' });
    const result = await rsync.rsyncPush(cfg, cwd, (p) =>
      emit({ type: 'sync_progress', transferred: p.transferred, total: p.total }),
    );
    emit({
      type: 'sync_done',
      filesChanged: result.filesChanged,
      durationMs: result.durationMs,
    });
    return;
  }

  log.step(`Syncing ${cfg.project} → ${cfg.remote.user}@${cfg.remote.host}:${cfg.remote.path}`);
  const result = await rsync.rsyncPush(cfg, cwd);
  log.ok(`Sync complete in ${result.durationMs}ms`);
}
