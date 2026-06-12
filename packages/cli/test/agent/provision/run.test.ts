import { describe, it, expect } from 'vitest';
import { runProvision } from '../../../src/agent/provision/run.ts';
import type { ProvisionPlan, ProvisionEvent, StepExecutor } from '../../../src/agent/provision/types.ts';

const PLAN: ProvisionPlan = {
  steps: [
    { id: 'a', title: 'A', requiresElevation: false },
    { id: 'b', title: 'B', requiresElevation: false },
    { id: 'c', title: 'C', requiresElevation: false },
  ],
};

describe('runProvision', () => {
  it('runs all steps and reports completed (no rollback)', async () => {
    const events: ProvisionEvent[] = [];
    const executor: StepExecutor = async () => ({ result: { ok: true } });
    const out = await runProvision(PLAN, { executor, onEvent: (e) => events.push(e) });
    expect(out).toEqual({ status: 'completed' });
    expect(events.filter((e) => e.type === 'step' && e.status === 'ok').length).toBe(3);
    expect(events.some((e) => e.type === 'rollback')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'done', status: 'completed' });
  });

  it('rolls back applied steps in reverse order when a step fails', async () => {
    const order: string[] = [];
    const executor: StepExecutor = async (step) => {
      if (step.id === 'c') return { result: { ok: false, detail: 'boom' } };
      return { result: { ok: true }, compensate: async () => { order.push(`undo-${step.id}`); } };
    };
    const events: ProvisionEvent[] = [];
    const out = await runProvision(PLAN, { executor, onEvent: (e) => events.push(e) });
    expect(out).toEqual({ status: 'rolled-back', failedStep: 'c' });
    expect(order).toEqual(['undo-b', 'undo-a']); // reverse order, c registered nothing
    expect(events.at(-1)).toEqual({ type: 'done', status: 'rolled-back', failedStep: 'c' });
  });

  it('treats a thrown executor as a failed step and rolls back', async () => {
    const order: string[] = [];
    const executor: StepExecutor = async (step) => {
      if (step.id === 'b') throw new Error('kaboom');
      return { result: { ok: true }, compensate: async () => { order.push(`undo-${step.id}`); } };
    };
    const out = await runProvision(PLAN, { executor });
    expect(out).toEqual({ status: 'rolled-back', failedStep: 'b' });
    expect(order).toEqual(['undo-a']);
  });

  it('does not let a failing compensation abort the rollback', async () => {
    const order: string[] = [];
    const executor: StepExecutor = async (step) => {
      if (step.id === 'c') return { result: { ok: false } };
      return {
        result: { ok: true },
        compensate: async () => {
          if (step.id === 'b') throw new Error('undo failed');
          order.push(`undo-${step.id}`);
        },
      };
    };
    const out = await runProvision(PLAN, { executor });
    expect(out.status).toBe('rolled-back');
    expect(order).toEqual(['undo-a']); // b's compensation threw but a's still ran
  });
});
