import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { RemoteConn } from './remote-detect.ts';
import { defaultRemoteRunner, type RemoteRunner } from './installer.ts';
import type { HealthReport } from './provision-remote.ts';

export interface VerifyDeps {
  /** Runs `tailscale status` on the remote (default: SSH over conn). */
  runner?: RemoteRunner;
  /** Probes the agent's /health endpoint (e.g. via AgentClient over the tailnet). */
  agentHealth: () => Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Build the orchestrator's non-fatal `verify`: tailnet reachability + agent /health.
 * Never throws — any failure is captured into the report.
 */
export function makeVerify(
  conn: RemoteConn,
  deps: VerifyDeps,
): (conn: RemoteConn, detected: DetectedServerPlatform) => Promise<HealthReport> {
  const runner = deps.runner ?? defaultRemoteRunner(conn);
  return async () => {
    const ts = await runner('tailscale status >/dev/null 2>&1');
    let agent: HealthReport['agent'] = 'unknown';
    let detail: string | undefined;
    try {
      const h = await deps.agentHealth();
      agent = h.ok ? 'healthy' : 'unhealthy';
      detail = h.detail;
    } catch (err) {
      agent = 'unhealthy';
      detail = err instanceof Error ? err.message : String(err);
    }
    return { tailnet: ts.code === 0, agent, detail };
  };
}
