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
 * Core verify logic: tailnet reachability + agent /health.
 * Never throws — any failure is captured into the report.
 */
export async function runVerify(conn: RemoteConn, deps: VerifyDeps): Promise<HealthReport> {
  const runner = deps.runner ?? defaultRemoteRunner(conn);
  let tailnet = false;
  try {
    const ts = await runner('tailscale status >/dev/null 2>&1');
    tailnet = ts.code === 0;
  } catch { /* tailnet probe failed — non-fatal */ }
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
  return { tailnet, agent, detail };
}

/**
 * Build the orchestrator's non-fatal `verify`: tailnet reachability + agent /health.
 * Never throws — any failure is captured into the report.
 */
export function makeVerify(
  conn: RemoteConn,
  deps: VerifyDeps,
): (conn: RemoteConn, detected: DetectedServerPlatform) => Promise<HealthReport> {
  return () => runVerify(conn, deps);
}
