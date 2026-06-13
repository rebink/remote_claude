import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { StepExecutor } from './types.ts';
import { corepackPnpmInstaller, defaultRemoteRunner, type AgentInstaller, type RemoteConn, type RemoteRunner } from './installer.ts';
import { quoteForShell } from '../../lib/ssh-runner.ts';

export interface RemoteExecutorOpts {
  /** Agent bearer token to provision onto the remote. */
  token: string;
  /** Override the agent installer (defaults to Corepack/pnpm for POSIX hosts). */
  installer?: AgentInstaller;
  /** Override the SSH command runner used by non-install steps. */
  runner?: RemoteRunner;
}

/** Atomic, mode-600 remote write driven over stdin so the token never hits the argv. */
const WRITE_ENV_CMD =
  'umask 077; mkdir -p "$HOME/.patchwire" && cat > "$HOME/.patchwire/env.tmp" && mv -f "$HOME/.patchwire/env.tmp" "$HOME/.patchwire/env"';

/**
 * Build the StepExecutor that `runProvision` drives, dispatching each step to a remote action.
 * This slice implements `bootstrap-agent`; other steps complete as degraded until their slices land.
 */
export function remoteExecutor(
  conn: RemoteConn,
  detected: DetectedServerPlatform,
  opts: RemoteExecutorOpts,
): StepExecutor {
  const installer = opts.installer ?? corepackPnpmInstaller(conn);
  const runner = opts.runner ?? defaultRemoteRunner(conn);
  return async (step) => {
    switch (step.id) {
      case 'bootstrap-agent':
        if (detected.os === 'windows') {
          return { result: { ok: false, detail: 'Windows agent install is not yet supported' } };
        }
        return installer.install();

      case 'write-secret': {
        const payload = `export PW_TOKEN=${quoteForShell(opts.token)}\n`;
        const r = await runner(WRITE_ENV_CMD, payload);
        if (r.code !== 0) {
          return { result: { ok: false, detail: (r.stderr || r.stdout || 'write-secret failed').trim() } };
        }
        return {
          result: { ok: true, detail: 'token written to ~/.patchwire/env (mode 600)' },
          compensate: async () => {
            await runner('rm -f "$HOME/.patchwire/env"');
          },
        };
      }

      default:
        return { result: { ok: true, degraded: true, detail: `step "${step.id}" not yet implemented` } };
    }
  };
}
