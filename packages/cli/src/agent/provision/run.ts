import type {
  ProvisionPlan,
  RunProvisionDeps,
  ProvisionOutcome,
  ProvisionEvent,
  CompensatingAction,
} from './types.ts';

/** Run a provisioning plan; on a step failure, roll back applied steps in reverse order. */
export async function runProvision(plan: ProvisionPlan, deps: RunProvisionDeps): Promise<ProvisionOutcome> {
  const emit = deps.onEvent ?? (() => {});
  const applied: { step: string; compensate: CompensatingAction }[] = [];

  emit({ type: 'phase', phase: 'execute' });
  for (const step of plan.steps) {
    emit({ type: 'step', step: step.id, status: 'start' });

    let outcome: { result: { ok: boolean; detail?: string }; compensate?: CompensatingAction };
    try {
      outcome = await deps.executor(step);
    } catch (err) {
      outcome = { result: { ok: false, detail: err instanceof Error ? err.message : String(err) } };
    }

    if (!outcome.result.ok) {
      emit({ type: 'step', step: step.id, status: 'failed', detail: outcome.result.detail });
      await rollback(applied, emit);
      emit({ type: 'done', status: 'rolled-back', failedStep: step.id });
      return { status: 'rolled-back', failedStep: step.id };
    }

    emit({ type: 'step', step: step.id, status: 'ok', detail: outcome.result.detail });
    if (outcome.compensate) applied.push({ step: step.id, compensate: outcome.compensate });
  }

  emit({ type: 'done', status: 'completed' });
  return { status: 'completed' };
}

async function rollback(
  applied: { step: string; compensate: CompensatingAction }[],
  emit: (e: ProvisionEvent) => void,
): Promise<void> {
  emit({ type: 'phase', phase: 'rollback' });
  for (let i = applied.length - 1; i >= 0; i--) {
    const a = applied[i]!;
    emit({ type: 'rollback', step: a.step });
    try {
      await a.compensate();
    } catch {
      /* best-effort: a failing compensation must not abort the rest of the rollback */
    }
  }
}
