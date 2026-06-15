/**
 * sync-session.ts — Command handlers for mutagen sync-session operations.
 *
 * Each handler accepts an injectable SyncDeps so tests can pass fake runners
 * and capture printed JSON without spawning a real mutagen binary.
 *
 * Production deps are built via realDeps() in cli.ts (Task 6).
 */

import { spawnSync } from "node:child_process";
import {
  sessionName,
  ensureSession,
  getStatus,
  pauseSession,
  resumeSession,
  flushSession,
  stopSession,
  type MutagenTarget,
  type MutagenRunner,
  type MutagenStatus,
} from "../lib/mutagen.ts";
import { ensureSshConfigStanza } from "../lib/mutagen-ssh.ts";

// ---------------------------------------------------------------------------
// Injectable deps interface
// ---------------------------------------------------------------------------

export interface SyncDeps {
  /** Map cwd → MutagenTarget (pure, no I/O in tests). */
  loadTarget: (cwd: string) => MutagenTarget;
  /** Resolve the mutagen binary path; returns null if not installed. */
  resolveBin: () => Promise<string | null>;
  /** Ensure the SSH config stanza for the target host. */
  ensureSsh: (t: { host: string; user: string; sshPort?: number }) => void;
  /** Mutagen runner (args → RunResult). Bound to binary in production. */
  run: MutagenRunner;
  /** Output sink (console.log in production, array-push in tests). */
  print: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emitStatus(print: (l: string) => void, status: MutagenStatus): void {
  const conflicts = "files" in status ? (status as { files: string[] }).files : [];
  print(JSON.stringify({ type: "sync_status", kind: status.kind, conflicts }));
}

function actionRunner(
  action: "pause" | "resume" | "flush" | "stop",
  op: (run: MutagenRunner, name: string) => void,
) {
  return async (cwd: string, deps: SyncDeps): Promise<void> => {
    const bin = await deps.resolveBin();
    if (!bin) { emitStatus(deps.print, { kind: "not_installed" }); return; }
    const t = deps.loadTarget(cwd);
    op(deps.run, sessionName(t.project, t.host));
    deps.print(JSON.stringify({ type: "sync_action", action, ok: true }));
  };
}

// ---------------------------------------------------------------------------
// Exported handlers
// ---------------------------------------------------------------------------

export async function runSyncStatus(cwd: string, deps: SyncDeps): Promise<void> {
  const bin = await deps.resolveBin();
  if (!bin) { emitStatus(deps.print, { kind: "not_installed" }); return; }
  const t = deps.loadTarget(cwd);
  emitStatus(deps.print, getStatus(deps.run, sessionName(t.project, t.host)));
}

export async function runSyncStart(cwd: string, deps: SyncDeps): Promise<void> {
  const bin = await deps.resolveBin();
  if (!bin) { emitStatus(deps.print, { kind: "not_installed" }); return; }
  const t = deps.loadTarget(cwd);
  deps.ensureSsh({ host: t.host, user: t.user, sshPort: t.sshPort });
  ensureSession(deps.run, t);
  deps.print(JSON.stringify({ type: "sync_action", action: "start", ok: true }));
}

export const runSyncPause = actionRunner("pause", pauseSession);
export const runSyncResume = actionRunner("resume", resumeSession);
export const runSyncFlush = actionRunner("flush", flushSession);
export const runSyncStop = actionRunner("stop", stopSession);

// ---------------------------------------------------------------------------
// Production deps factory
// ---------------------------------------------------------------------------

/**
 * Build production SyncDeps.
 *
 * @param loadTargetFromConfig  Maps cwd → MutagenTarget from loaded config.
 *                              Provided by cli.ts (Task 6) to avoid a config
 *                              read dependency here.
 *
 * Returns a partial SyncDeps (without `run`) plus a `makeRun` factory so the
 * caller can bind the runner after the binary is resolved.
 */
export async function realDeps(
  loadTargetFromConfig: (cwd: string) => MutagenTarget,
): Promise<Omit<SyncDeps, "run"> & { makeRun: (bin: string) => MutagenRunner }> {
  const { createNodeHostPlatform } = await import("@patchwire/core");
  return {
    loadTarget: loadTargetFromConfig,
    resolveBin: async () => {
      try {
        return await createNodeHostPlatform().resolveMutagen();
      } catch {
        return null;
      }
    },
    ensureSsh: (t) => ensureSshConfigStanza(t),
    print: (l) => console.log(l),
    makeRun: (bin) => (args) => {
      const r = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000 });
      return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}
