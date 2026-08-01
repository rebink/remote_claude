/**
 * refresh.ts — Destructive "force refresh" orchestrator.
 *
 * Terminates the live mutagen sync, purges + reseeds the remote folder from
 * local (via runInitRemote with overwrite+fromLocal), then recreates the sync
 * session. Pure orchestration over injectable deps so tests can drive it with
 * fakes and no real mutagen binary or SSH.
 *
 * Order is load-bearing: terminate → init → (only on init success) recreate.
 */

import { spawnSync } from "node:child_process";
import {
  sessionName,
  ensureSession,
  stopSession,
  type MutagenRunner,
  type MutagenTarget,
} from "../lib/mutagen.ts";
import { runInitRemote, type InitRemoteResult } from "./init-remote.ts";
import { ensureSshConfigStanza } from "../lib/mutagen-ssh.ts";

// ---------------------------------------------------------------------------
// Injectable deps interface
// ---------------------------------------------------------------------------

export interface RefreshDeps {
  /** Map cwd → MutagenTarget (pure, no I/O in tests). */
  loadTarget: (cwd: string) => MutagenTarget;
  /** Resolve the mutagen binary path; returns null if not installed. */
  resolveBin: () => Promise<string | null>;
  /** Build a mutagen runner bound to the resolved binary. */
  makeRun: (bin: string) => MutagenRunner;
  /** Ensure the SSH config stanza for the target host. */
  ensureSsh: (t: { host: string; user: string; sshPort?: number }) => void;
  /** Purge + reseed the remote folder from local. */
  initRemote: (target: MutagenTarget, json: boolean) => Promise<InitRemoteResult>;
  /** Output sink (console.log in production, array-push in tests). */
  print: (line: string) => void;
}

export interface RefreshOpts {
  confirmed: boolean;
  json: boolean;
}

export interface RefreshResult {
  ok: boolean;
  code?: string;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runRefresh(
  cwd: string,
  deps: RefreshDeps,
  opts: RefreshOpts,
): Promise<RefreshResult> {
  const emit = (obj: unknown) => deps.print(JSON.stringify(obj));

  if (!opts.confirmed) {
    emit({ type: "refresh_aborted", reason: "unconfirmed" });
    return { ok: false, code: "unconfirmed" };
  }

  const t = deps.loadTarget(cwd);
  emit({ type: "refresh_start", project: t.project, remotePath: t.remotePath });

  const bin = await deps.resolveBin();
  if (!bin) {
    emit({ type: "refresh_aborted", reason: "not_installed" });
    return { ok: false, code: "not_installed" };
  }
  const run = deps.makeRun(bin);
  const name = sessionName(t.project, t.host, t.localPath);

  // 1. Terminate the live sync FIRST so it can't race the purge/reseed.
  stopSession(run, name);
  emit({ type: "refresh_step", step: "terminate_sync", ok: true });

  // 2. Purge + reseed the remote from local.
  const init = await deps.initRemote(t, opts.json);
  if (!init.ok) {
    emit({ type: "refresh_done", ok: false, code: init.code, stderr: init.stderr });
    return { ok: false, code: init.code };
  }

  // 3. Only on init success: recreate the sync session.
  deps.ensureSsh({ host: t.host, user: t.user, sshPort: t.sshPort });
  ensureSession(run, t);
  emit({ type: "refresh_step", step: "recreate_sync", ok: true });

  emit({ type: "refresh_done", ok: true, remotePath: t.remotePath });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Production deps factory — mirrors sync-session.ts realDeps.
// ---------------------------------------------------------------------------

/**
 * Build production RefreshDeps.
 *
 * Mirrors sync-session.ts realDeps for binary resolution (resolveMutagen),
 * the spawnSync-based runner, and ensureSshConfigStanza. `initRemote` wraps
 * runInitRemote with overwrite+fromLocal to purge and reseed the remote.
 *
 * @param loadTarget  Maps cwd → MutagenTarget from loaded config. Provided by
 *                    cli.ts to avoid a config-read dependency here.
 */
export function realRefreshDeps(
  loadTarget: (cwd: string) => MutagenTarget,
): RefreshDeps {
  return {
    loadTarget,
    resolveBin: async () => {
      try {
        const { createNodeHostPlatform } = await import("@patchwire/core");
        return await createNodeHostPlatform().resolveMutagen();
      } catch {
        return null;
      }
    },
    makeRun: (bin) => (args) => {
      const r = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000 });
      return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    ensureSsh: (t) => ensureSshConfigStanza(t),
    initRemote: (target, json) =>
      runInitRemote({
        fromLocal: true,
        project: target.project,
        host: target.host,
        user: target.user,
        sshPort: target.sshPort,
        localPath: target.localPath,
        remotePath: target.remotePath,
        overwrite: true,
        json,
      }),
    print: (l) => console.log(l),
  };
}
