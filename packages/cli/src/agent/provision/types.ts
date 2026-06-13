export type ProvisionPhase = 'detect' | 'plan' | 'consent' | 'execute' | 'verify' | 'rollback';

export interface ProvisionStep {
  id: string;
  title: string;
  requiresElevation: boolean;
}

export interface ProvisionPlan {
  steps: ProvisionStep[];
}

export interface StepResult {
  ok: boolean;
  /** Completed, but a non-critical capability isn't fully there (e.g. egress warn-only). Not a failure. */
  degraded?: boolean;
  detail?: string;
}

/** Undo a previously-applied step. Best-effort, idempotent. */
export type CompensatingAction = () => Promise<void>;

/** Execute one step; return its result plus an optional compensating action to undo it. */
export type StepExecutor = (
  step: ProvisionStep,
) => Promise<{ result: StepResult; compensate?: CompensatingAction }>;

export type ProvisionEvent =
  | { type: 'phase'; phase: ProvisionPhase }
  | { type: 'step'; step: string; status: 'start' | 'ok' | 'degraded' | 'failed'; detail?: string }
  | { type: 'rollback'; step: string }
  | { type: 'done'; status: 'completed' | 'rolled-back'; failedStep?: string };

export interface RunProvisionDeps {
  executor: StepExecutor;
  onEvent?: (e: ProvisionEvent) => void;
}

export interface ProvisionOutcome {
  status: 'completed' | 'rolled-back';
  failedStep?: string;
  /** Details of steps that completed in a degraded state. */
  degraded: string[];
}
