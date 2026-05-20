import { describe, it, expect } from 'vitest';
import { TurnState } from '../../src/agent/turn-state.ts';

describe('TurnState', () => {
  it('records in-flight turns and lets you fetch state by uuid', () => {
    const t = new TurnState();
    t.start('u1');
    expect(t.get('u1')).toMatchObject({ status: 'in_flight' });
    t.complete('u1', { tokensIn: 0, tokensOut: 10, durationMs: 1234 });
    expect(t.get('u1')).toMatchObject({ status: 'done', durationMs: 1234 });
  });
});
