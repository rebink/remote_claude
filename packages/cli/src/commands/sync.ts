import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.ts';
import * as rsync from '../lib/rsync.ts';
import { runSsh } from '../lib/ssh-runner.ts';
import { log } from '../lib/log.ts';
import { preSyncSecretGate } from '../lib/secret-scan.ts';
import { assertRsyncAvailable } from '../lib/rsync-preflight.ts';
import type { Config } from '../lib/config.ts';

export interface SyncOpts {
  json?: boolean;
  force?: boolean;
}

/**
 * After a successful rsync push, commit the Mini's working tree to the
 * sandbox repo so HEAD tracks the latest laptop state. This is what makes
 * `Pull remote changes` work correctly: with HEAD advanced after every push,
 * `git diff HEAD` on the Mini only shows changes made AFTER the last sync
 * (i.e., claude's edits on the remote), not stale bootstrap-time differences.
 *
 * Best-effort: a failure here is logged but doesn't fail the sync (the user's
 * files made it to the Mini regardless; the HEAD-tracking just won't update).
 */
async function commitPostPush(cfg: Config): Promise<void> {
  const keyPath = join(homedir(), '.patchwire', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
  if (!existsSync(keyPath)) return;
  // `git add -A`: stage everything including untracked and deletions.
  // `--allow-empty`: commit even when no changes (rsync was a no-op).
  // sandbox identity matches bootstrap-snapshot's gitInitScript so author
  // history stays clean — all auto-commits attributed to the sandbox identity.
  const cmd = [
    `cd ${cfg.remote.path}`,
    `git add -A`,
    `git -c user.email='patchwire@local' -c user.name='Patchwire (sandbox)' -c commit.gpgsign=false commit -q --allow-empty -m 'live-sync push'`,
  ].join(' && ');
  const r = await runSsh({
    host: cfg.remote.host,
    user: cfg.remote.user,
    port: cfg.remote.sshPort ?? 22,
    keyPath,
    command: cmd,
  });
  if (r.code !== 0) {
    log.warn(`post-push commit on remote failed (non-fatal): ${r.stderr.trim()}`);
  }
}

export async function runSync(cwd: string, opts: SyncOpts = {}): Promise<void> {
  const cfg = await loadConfig(cwd);

  if (!(await preSyncSecretGate(cwd, cfg.sync.secretScan, !!opts.force))) {
    process.exitCode = 1;
    return;
  }

  assertRsyncAvailable();

  if (opts.json) {
    const emit = (e: unknown): void => {
      process.stdout.write(JSON.stringify(e) + '\n');
    };
    emit({ type: 'sync_start' });
    const result = await rsync.rsyncPush(cfg, cwd, (p) =>
      emit({ type: 'sync_progress', transferred: p.transferred, total: p.total }),
    );
    await commitPostPush(cfg);
    emit({
      type: 'sync_done',
      filesChanged: result.filesChanged,
      durationMs: result.durationMs,
    });
    return;
  }

  log.step(`Syncing ${cfg.project} → ${cfg.remote.user}@${cfg.remote.host}:${cfg.remote.path}`);
  const result = await rsync.rsyncPush(cfg, cwd);
  await commitPostPush(cfg);
  log.ok(`Sync complete in ${result.durationMs}ms`);
}
