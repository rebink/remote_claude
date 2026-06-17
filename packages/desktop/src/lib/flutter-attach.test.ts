import { describe, it, expect } from 'vitest';
import { reduceAttach, initialAttach, type AttachState } from './flutter-attach';

describe('reduceAttach', () => {
  it('starts detached', () => {
    expect(initialAttach.kind).toBe('detached');
  });
  it('attach request → attaching', () => {
    const s = reduceAttach(initialAttach, { type: 'attach_requested' });
    expect(s.kind).toBe('attaching');
  });
  it('attached event carries target + capabilities', () => {
    const s = reduceAttach({ kind: 'attaching' } as AttachState, { type: 'attached', target: 'web' });
    expect(s.kind).toBe('attached');
    if (s.kind === 'attached') {
      expect(s.target).toBe('web');
      expect(s.capabilities.screenshot).toBe(false);
    }
  });
  it('error event carries a message', () => {
    const s = reduceAttach({ kind: 'attaching' } as AttachState, { type: 'error', message: 'bad uri' });
    expect(s).toEqual({ kind: 'error', message: 'bad uri' });
  });
  it('vm closed while attached → detached', () => {
    const s = reduceAttach({ kind: 'attached', target: 'device', capabilities: { hotReload: true, screenshot: true, inspect: true, logs: true } }, { type: 'vm_closed' });
    expect(s.kind).toBe('detached');
  });
});
