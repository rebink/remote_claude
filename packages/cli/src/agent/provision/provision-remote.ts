import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { ProvisionPlan, ProvisionStep, StepExecutor, ProvisionEvent, ProvisionOutcome } from './types.ts';
import { planProvision, elevationRequired } from './plan.ts';
import { runProvision } from './run.ts';
import { detectRemoteServerPlatform, type RemoteConn } from './remote-detect.ts';
import { remoteExecutor, type RemoteExecutorOpts } from './remote-executor.ts';

/** Non-fatal post-provision health snapshot. */
export interface HealthReport {
  tailnet: boolean;
  agent: 'healthy' | 'unhealthy' | 'unknown';
  detail?: string;
}

export type ProvisionStatus = 'completed' | 'rolled-back' | 'cancelled';

export interface ProvisionRemoteResult {
  status: ProvisionStatus;
  detected?: DetectedServerPlatform;
  plan?: ProvisionPlan;
  outcome?: ProvisionOutcome;
  health?: HealthReport;
}

/** A preview emitted before consent — the full plan plus the steps that need elevation. */
export interface PreviewEvent {
  type: 'preview';
  plan: ProvisionPlan;
  elevation: ProvisionStep[];
}

export interface ProvisionRemoteDeps {
  detect?: (conn: RemoteConn) => Promise<DetectedServerPlatform>;
  makeExecutor?: (conn: RemoteConn, detected: DetectedServerPlatform, opts: RemoteExecutorOpts) => StepExecutor;
  /** Non-fatal verification, run only on a completed outcome. */
  verify?: (conn: RemoteConn, detected: DetectedServerPlatform) => Promise<HealthReport>;
  /** Consent gate shown the plan + elevation-needing steps; return true to proceed. Omit to proceed unconditionally. */
  confirm?: (plan: ProvisionPlan, elevation: ProvisionStep[]) => boolean | Promise<boolean>;
  onEvent?: (e: ProvisionEvent | PreviewEvent) => void;
}

/** Orchestrate remote provisioning: detect → plan → preview → consent → execute → verify. */
export async function provisionRemote(
  conn: RemoteConn,
  opts: RemoteExecutorOpts,
  deps: ProvisionRemoteDeps = {},
): Promise<ProvisionRemoteResult> {
  const detect = deps.detect ?? detectRemoteServerPlatform;
  const makeExecutor = deps.makeExecutor ?? remoteExecutor;
  const emit = deps.onEvent ?? (() => {});

  const detected = await detect(conn);
  const plan = planProvision(detected);
  const elevation = elevationRequired(plan);
  emit({ type: 'preview', plan, elevation });

  if (deps.confirm) {
    const proceed = await deps.confirm(plan, elevation);
    if (!proceed) return { status: 'cancelled', detected, plan };
  }

  const outcome = await runProvision(plan, {
    executor: makeExecutor(conn, detected, opts),
    onEvent: emit as (e: ProvisionEvent) => void,
  });

  let health: HealthReport | undefined;
  if (outcome.status === 'completed' && deps.verify) {
    health = await deps.verify(conn, detected);
  }

  return { status: outcome.status, detected, plan, outcome, health };
}
