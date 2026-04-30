import { loadConfig } from '../lib/config.ts';
import { rsyncPush } from '../lib/rsync.ts';
import { log } from '../lib/log.ts';

export async function runSync(cwd: string): Promise<void> {
  const cfg = await loadConfig(cwd);
  log.step(`Syncing ${cfg.project} → ${cfg.remote.user}@${cfg.remote.host}:${cfg.remote.path}`);
  const result = await rsyncPush(cfg, cwd);
  log.ok(`Sync complete in ${result.durationMs}ms`);
}
