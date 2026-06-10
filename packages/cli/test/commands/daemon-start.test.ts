import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cp from 'node:child_process';
import { startLaunchAgent } from '../../src/commands/daemon.ts';

vi.mock('node:child_process');

afterEach(() => vi.restoreAllMocks());

describe('startLaunchAgent', () => {
  it('uses bootstrap when it succeeds', () => {
    const spy = vi.spyOn(cp, 'spawnSync').mockImplementation((_c, args) =>
      (args as string[])[0] === 'bootstrap' ? { status: 0, stdout: '', stderr: '' } as never
                                            : { status: 0, stdout: '', stderr: '' } as never);
    const r = startLaunchAgent('/tmp/x.plist', 501);
    expect(r.ok).toBe(true);
    expect(r.method).toBe('bootstrap');
  });
  it('falls back to load when bootstrap fails', () => {
    vi.spyOn(cp, 'spawnSync').mockImplementation((_c, args) => {
      const a = args as string[];
      if (a[0] === 'bootstrap') return { status: 5, stdout: '', stderr: 'Bootstrap failed' } as never;
      if (a[0] === 'load') return { status: 0, stdout: '', stderr: '' } as never;
      return { status: 0, stdout: '', stderr: '' } as never;
    });
    const r = startLaunchAgent('/tmp/x.plist', 501);
    expect(r.ok).toBe(true);
    expect(r.method).toBe('load');
  });
  it('reports failure with stderr when nothing starts it', () => {
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 5, stdout: '', stderr: 'Input/output error' } as never);
    const r = startLaunchAgent('/tmp/x.plist', 501);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/Input\/output error/);
  });
});
