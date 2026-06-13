import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { StepExecutor } from './types.ts';
import { corepackPnpmInstaller, defaultRemoteRunner, type AgentInstaller, type RemoteConn, type RemoteRunner } from './installer.ts';
import { quoteForShell } from '../../lib/ssh-runner.ts';

export interface RemoteExecutorOpts {
  /** Agent bearer token to provision onto the remote. */
  token: string;
  /** Agent network host written into the remote env (default loopback). */
  host?: string;
  /** Agent port (default 7878). */
  port?: number;
  /** AI binary the agent spawns (default 'claude'). */
  aiBin?: string;
  /** Override the agent installer (defaults to Corepack/pnpm for POSIX hosts). */
  installer?: AgentInstaller;
  /** Override the SSH command runner used by non-install steps. */
  runner?: RemoteRunner;
}

/** Atomic, mode-600 write of the agent env file, driven over stdin (token never on argv). */
const WRITE_ENV_CMD =
  'umask 077; mkdir -p "$HOME/.patchwire" && cat > "$HOME/.patchwire/agent.env.tmp" && mv -f "$HOME/.patchwire/agent.env.tmp" "$HOME/.patchwire/agent.env"';

/** Idempotently set PW_EGRESS=deny in the agent env (strip any prior line, append, tmp→rename). */
const SET_EGRESS_DENY_CMD =
  'ENV="$HOME/.patchwire/agent.env"; umask 077; { grep -v \'^export PW_EGRESS=\' "$ENV" 2>/dev/null; echo "export PW_EGRESS=deny"; } > "$ENV.tmp" && mv -f "$ENV.tmp" "$ENV"';
const UNSET_EGRESS_CMD =
  'ENV="$HOME/.patchwire/agent.env"; { grep -v \'^export PW_EGRESS=\' "$ENV" 2>/dev/null || true; } > "$ENV.tmp" && mv -f "$ENV.tmp" "$ENV"';

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
        const host = opts.host ?? '127.0.0.1';
        const port = opts.port ?? 7878;
        const aiBin = opts.aiBin ?? 'claude';
        const payload =
          '# patchwire-agent environment (managed by patchwire provisioning)\n' +
          `export PW_AGENT_TOKEN=${quoteForShell(opts.token)}\n` +
          `export PW_AGENT_HOST=${quoteForShell(host)}\n` +
          `export PW_AGENT_PORT=${quoteForShell(String(port))}\n` +
          `export PW_AI_BIN=${quoteForShell(aiBin)}\n`;
        const r = await runner(WRITE_ENV_CMD, payload);
        if (r.code !== 0) {
          return { result: { ok: false, detail: (r.stderr || r.stdout || 'write-secret failed').trim() } };
        }
        return {
          result: { ok: true, detail: 'agent env written to ~/.patchwire/agent.env (mode 600)' },
          compensate: async () => {
            await runner('rm -f "$HOME/.patchwire/agent.env"');
          },
        };
      }

      case 'install-service': {
        if (detected.os === 'macos') {
          const r = await runner("bash -lc 'patchwire-agent install'");
          if (r.code !== 0) {
            return { result: { ok: false, detail: (r.stderr || r.stdout || 'service install failed').trim() } };
          }
          return {
            result: { ok: true, detail: 'launchd service installed' },
            compensate: async () => { await runner("bash -lc 'patchwire-agent uninstall'"); },
          };
        }
        if (detected.os === 'linux') {
          return { result: { ok: true, degraded: true, detail: 'linux service install (systemd --user) not yet wired; run the agent manually' } };
        }
        return { result: { ok: true, degraded: true, detail: `service install not yet supported on ${detected.os}` } };
      }

      case 'install-mutagen': {
        const present = await runner('command -v mutagen >/dev/null 2>&1 || test -x "$HOME/.patchwire/bin/mutagen"');
        return present.code === 0
          ? { result: { ok: true, detail: 'mutagen present on remote' } }
          : { result: { ok: true, degraded: true, detail: 'mutagen not present; the agent will resolve it on first sync' } };
      }

      case 'bind-tailnet': {
        const r = await runner('tailscale status >/dev/null 2>&1');
        return r.code === 0
          ? { result: { ok: true, detail: 'tailnet: up' } }
          : { result: { ok: true, degraded: true, detail: 'Tailscale is not up on the remote; the agent may be unreachable — run `tailscale up`' } };
      }

      case 'apply-egress': {
        if (detected.capabilities.egress.type === 'none') {
          return { result: { ok: true, degraded: true, detail: `egress not enforceable on ${detected.os}; agent runs without network confinement` } };
        }
        const r = await runner(SET_EGRESS_DENY_CMD);
        if (r.code !== 0) {
          return { result: { ok: false, detail: (r.stderr || r.stdout || 'apply-egress failed').trim() } };
        }
        return {
          result: { ok: true, detail: `egress: deny (enforced via ${detected.capabilities.egress.type})` },
          compensate: async () => { await runner(UNSET_EGRESS_CMD); },
        };
      }

      default:
        return { result: { ok: true, degraded: true, detail: `step "${step.id}" not yet implemented` } };
    }
  };
}
