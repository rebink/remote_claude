import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { StepExecutor } from './types.ts';
import { corepackPnpmInstaller, defaultRemoteRunner, type AgentInstaller, type RemoteConn, type RemoteRunner } from './installer.ts';
import { buildAgentEnv, WRITE_AGENT_ENV_CMD, POSIX_PATH_PREFIX, POSIX_PNPM_ENV } from './primitives.ts';
import { WRITE_AGENT_ENV_PS, REMOVE_AGENT_ENV_PS, WINDOWS_AGENT_INSTALL_PS, WINDOWS_AGENT_UNINSTALL_PS } from './windows-primitives.ts';
import { binaryInstaller } from './binary-installer.ts';
import type { BinaryArtifactSource } from './binary-installer.ts';

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
  /** When set (and no explicit installer), bootstrap via the prereq-free binary installer instead of Corepack/pnpm. */
  binarySource?: BinaryArtifactSource;
}

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
  const runner = opts.runner ?? defaultRemoteRunner(conn);
  const nodeAbsent = detected.node?.present === false;
  const installer = opts.installer
    ?? (opts.binarySource && nodeAbsent
      ? binaryInstaller(conn, { source: opts.binarySource, detected, runner })
      : corepackPnpmInstaller(conn, runner));
  return async (step) => {
    switch (step.id) {
      case 'bootstrap-agent':
        return installer.install();

      case 'write-secret': {
        const payload = buildAgentEnv({ token: opts.token, host: opts.host, port: opts.port, aiBin: opts.aiBin });
        if (detected.os === 'windows') {
          const r = await runner(WRITE_AGENT_ENV_PS, payload);
          if (r.code !== 0) return { result: { ok: false, detail: (r.stderr || r.stdout || 'write-secret failed').trim() } };
          return {
            result: { ok: true, detail: 'agent env written to %USERPROFILE%\\.patchwire\\agent.env' },
            compensate: async () => { await runner(REMOVE_AGENT_ENV_PS); },
          };
        }
        const r = await runner(WRITE_AGENT_ENV_CMD, payload);
        if (r.code !== 0) {
          return { result: { ok: false, detail: (r.stderr || r.stdout || 'write-secret failed').trim() } };
        }
        return {
          result: { ok: true, detail: 'agent env written to ~/.patchwire/agent.env (mode 600)' },
          compensate: async () => { await runner('rm -f "$HOME/.patchwire/agent.env"'); },
        };
      }

      case 'install-service': {
        if (detected.os === 'macos' || detected.os === 'linux') {
          const r = await runner(`bash -lc '${POSIX_PATH_PREFIX}${POSIX_PNPM_ENV}patchwire-agent install'`);
          if (r.code !== 0) {
            return { result: { ok: false, detail: (r.stderr || r.stdout || 'service install failed').trim() } };
          }
          const detail = detected.os === 'macos' ? 'launchd service installed' : 'systemd --user service installed';
          return {
            result: { ok: true, detail },
            compensate: async () => { await runner(`bash -lc '${POSIX_PATH_PREFIX}${POSIX_PNPM_ENV}patchwire-agent uninstall'`); },
          };
        }
        if (detected.os === 'windows') {
          const r = await runner(WINDOWS_AGENT_INSTALL_PS);
          if (r.code !== 0) return { result: { ok: false, detail: (r.stderr || r.stdout || 'service install failed').trim() } };
          return {
            result: { ok: true, detail: 'scheduled task installed' },
            compensate: async () => { await runner(WINDOWS_AGENT_UNINSTALL_PS); },
          };
        }
        return { result: { ok: true, degraded: true, detail: `service install not yet supported on ${detected.os}` } };
      }

      case 'install-mutagen': {
        const present = await runner(`${POSIX_PATH_PREFIX}command -v mutagen >/dev/null 2>&1 || test -x "$HOME/.patchwire/bin/mutagen"`);
        return present.code === 0
          ? { result: { ok: true, detail: 'mutagen present on remote' } }
          : { result: { ok: true, degraded: true, detail: 'mutagen not present; the agent will resolve it on first sync' } };
      }

      case 'bind-tailnet': {
        const r = await runner(`${POSIX_PATH_PREFIX}tailscale status >/dev/null 2>&1`);
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

      case 'install-claude': {
        const r = await runner(`${POSIX_PATH_PREFIX}command -v claude >/dev/null 2>&1`);
        return r.code === 0
          ? { result: { ok: true, detail: 'claude CLI present' } }
          : { result: { ok: true, degraded: true, detail: 'Claude Code CLI not found — install it and run `claude /login` on the remote (the agent needs it to run tasks)' } };
      }

      default:
        return { result: { ok: true, degraded: true, detail: `step "${step.id}" not yet implemented` } };
    }
  };
}
