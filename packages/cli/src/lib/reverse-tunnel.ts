// packages/cli/src/lib/reverse-tunnel.ts
import { spawn, type ChildProcess } from 'node:child_process';

export interface ReverseTunnelOpts {
  host: string;
  user: string;
  port: number;
  keyPath: string;
  remotePort: number;
  localPort: number;
}

/**
 * Build `ssh -R` args for a reverse tunnel that exposes a locally-running
 * service (127.0.0.1:localPort) on the remote's LOOPBACK only
 * (127.0.0.1:remotePort) — so only processes on the agent host can reach it.
 * `-N` = no remote command; `ExitOnForwardFailure` = fail fast if the remote
 * port is taken.
 */
export function buildReverseTunnelArgs(o: ReverseTunnelOpts): string[] {
  return [
    '-i', o.keyPath,
    '-p', String(o.port),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-N',
    '-R', `127.0.0.1:${o.remotePort}:127.0.0.1:${o.localPort}`,
    `${o.user}@${o.host}`,
  ];
}

export interface TunnelHandle {
  stop(): void;
}

export type TunnelSpawn = (cmd: string, args: string[]) => Pick<ChildProcess, 'kill' | 'on'>;

const defaultSpawn: TunnelSpawn = (cmd, args) => spawn(cmd, args, { stdio: 'ignore' });

/** Open the reverse tunnel. `onExit` fires with the ssh exit code when it closes. */
export function openReverseTunnel(
  o: ReverseTunnelOpts,
  spawnAdapter: TunnelSpawn = defaultSpawn,
  onExit?: (code: number | null) => void,
): TunnelHandle {
  const child = spawnAdapter('ssh', buildReverseTunnelArgs(o));
  if (onExit) child.on('close', (code: number | null) => onExit(code));
  return { stop: () => child.kill() };
}
