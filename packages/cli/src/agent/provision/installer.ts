import { runSsh, type SshOpts } from '../../lib/ssh-runner.ts';
import type { StepResult, CompensatingAction } from './types.ts';

/** SSH connection params without the per-call `command`. */
export type RemoteConn = Omit<SshOpts, 'command'>;

/** Runs one command on the remote, returning its streams + exit code. Injected for testing. */
export type RemoteRunner = (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>;

/** Installs/uninstalls the patchwire agent on a remote. One impl per OS / distribution mechanism. */
export interface AgentInstaller {
  /** Installed agent version, or null if absent. */
  version(): Promise<string | null>;
  /** Presence + version. */
  check(): Promise<{ present: boolean; version?: string }>;
  /** Install the agent; returns a result and (on success) a compensating uninstall. */
  install(): Promise<{ result: StepResult; compensate?: CompensatingAction }>;
  /** Remove the agent. */
  uninstall(): Promise<StepResult>;
}

/** Pinned to the repo's `packageManager` so the remote uses the same pnpm. */
const PNPM_VERSION = '10.26.1';
const PACKAGE = '@rebink/patchwire';

function defaultRunner(conn: RemoteConn): RemoteRunner {
  return async (command) => {
    const r = await runSsh({ ...conn, command });
    return { stdout: r.stdout, stderr: r.stderr, code: r.code };
  };
}

/** POSIX (macOS + Linux) installer: Corepack-activated pnpm installs the agent globally. */
export function corepackPnpmInstaller(
  conn: RemoteConn,
  runner: RemoteRunner = defaultRunner(conn),
): AgentInstaller {
  async function version(): Promise<string | null> {
    const r = await runner('patchwire --version');
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async function uninstall(): Promise<StepResult> {
    const r = await runner(`pnpm remove -g ${PACKAGE}`);
    return r.code === 0
      ? { ok: true, detail: 'removed' }
      : { ok: false, detail: (r.stderr || r.stdout || 'uninstall failed').trim() };
  }

  return {
    version,
    uninstall,
    async check() {
      const v = await version();
      return v === null ? { present: false } : { present: true, version: v };
    },
    async install() {
      const cmd =
        `corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate && pnpm add -g ${PACKAGE}`;
      const r = await runner(cmd);
      if (r.code !== 0) {
        return { result: { ok: false, detail: (r.stderr || r.stdout || 'install failed').trim() } };
      }
      return {
        result: { ok: true, detail: `installed ${PACKAGE} via corepack+pnpm` },
        compensate: async () => {
          await uninstall();
        },
      };
    },
  };
}
