import { runSsh, type SshOpts } from '../../lib/ssh-runner.ts';
import type { StepResult, CompensatingAction } from './types.ts';
import { AGENT_INSTALL_CMD, AGENT_PACKAGE } from './primitives.ts';

/** SSH connection params without the per-call `command`. */
export type RemoteConn = Omit<SshOpts, 'command'>;

/** Runs one command on the remote, returning its streams + exit code. Injected for testing. */
export type RemoteRunner = (command: string, input?: string) => Promise<{ stdout: string; stderr: string; code: number | null }>;

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


export function defaultRemoteRunner(conn: RemoteConn): RemoteRunner {
  return async (command, input) => {
    const r = await runSsh({ ...conn, command, input });
    return { stdout: r.stdout, stderr: r.stderr, code: r.code };
  };
}

/** POSIX (macOS + Linux) installer: Corepack-activated pnpm installs the agent globally. */
export function corepackPnpmInstaller(
  conn: RemoteConn,
  runner: RemoteRunner = defaultRemoteRunner(conn),
): AgentInstaller {
  async function version(): Promise<string | null> {
    const r = await runner('patchwire --version');
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async function uninstall(): Promise<StepResult> {
    const r = await runner(`pnpm remove -g ${AGENT_PACKAGE}`);
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
      const r = await runner(AGENT_INSTALL_CMD);
      if (r.code !== 0) {
        return { result: { ok: false, detail: (r.stderr || r.stdout || 'install failed').trim() } };
      }
      return {
        result: { ok: true, detail: `installed ${AGENT_PACKAGE} via corepack+pnpm` },
        compensate: async () => {
          await uninstall();
        },
      };
    },
  };
}
