import { describe, it, expect } from 'vitest';
import { initialState, reduce } from './provision-state.ts';
describe('provision reducer', () => {
  it('preview sets phase=preview + plan + awaitingConsent', () => {
    const s = reduce(initialState(), '{"type":"preview","plan":{"steps":[{"id":"bootstrap-agent"}]},"elevation":[]}');
    expect(s.phase).toBe('preview');
    expect(s.steps.map((x) => x.id)).toEqual(['bootstrap-agent']);
    expect(s.awaitingConsent).toBe(true);
  });
  it('step lines move to executing', () => {
    let s = reduce(initialState(), '{"type":"preview","plan":{"steps":[{"id":"a"}]},"elevation":[]}');
    s = reduce(s, '{"type":"step","step":"a","status":"start"}');
    s = reduce(s, '{"type":"step","step":"a","status":"ok","detail":"done"}');
    expect(s.phase).toBe('executing');
    expect(s.events.at(-1)).toMatchObject({ type: 'step', step: 'a', status: 'ok' });
  });
  it('result sets terminal status + health', () => {
    const s = reduce(initialState(), '{"type":"result","status":"completed","health":{"tailnet":false,"agent":"healthy"}}');
    expect(s.phase).toBe('done');
    expect(s.result).toMatchObject({ status: 'completed', health: { agent: 'healthy' } });
  });
  it('ignores malformed lines', () => {
    expect(reduce(initialState(), 'not json').phase).toBe('idle');
  });
  it('tracks per-step status as steps stream', () => {
    let s = reduce(initialState(), '{"type":"preview","plan":{"steps":[{"id":"a"},{"id":"b"}]},"elevation":[]}');
    s = reduce(s, '{"type":"step","step":"a","status":"start"}');
    s = reduce(s, '{"type":"step","step":"a","status":"ok","detail":"done"}');
    s = reduce(s, '{"type":"step","step":"b","status":"degraded","detail":"tailscale down"}');
    expect(s.stepStatus.a).toMatchObject({ status: 'ok', detail: 'done' });
    expect(s.stepStatus.b).toMatchObject({ status: 'degraded', detail: 'tailscale down' });
    expect(s.degraded).toContain('b');
  });
  it('result carries failedStep on rollback', () => {
    const s = reduce(initialState(), '{"type":"result","status":"rolled-back","outcome":{"status":"rolled-back","failedStep":"bootstrap-agent","degraded":[]}}');
    expect(s.phase).toBe('done');
    expect(s.result).toMatchObject({ status: 'rolled-back', failedStep: 'bootstrap-agent' });
  });
});
