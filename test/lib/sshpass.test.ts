import { describe, it, expect, vi } from 'vitest';
import { resolveSshpassPath, copyIdWithPassword } from '../../src/lib/sshpass.ts';
import * as fs from 'node:fs';
import * as cp from 'node:child_process';

vi.mock('node:child_process');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual };
});

describe('resolveSshpassPath', () => {
  it('returns the platform-specific vendored path when it exists', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (p) => String(p).endsWith(`sshpass-${process.platform}-${process.arch}`),
    );
    const out = resolveSshpassPath();
    expect(out).toMatch(/sshpass-/);
  });

  it('throws when no vendored or system binary is found', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(cp, 'spawnSync').mockReturnValue({
      status: 1,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      pid: 0,
      output: [],
      signal: null,
    } as unknown as cp.SpawnSyncReturns<Buffer>);
    expect(() => resolveSshpassPath()).toThrow(/sshpass not found/);
  });
});

describe('copyIdWithPassword', () => {
  it('passes password via fd, never as argv', async () => {
    const spawnSpy = vi.spyOn(cp, 'spawn').mockReturnValue({
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') queueMicrotask(() => cb(0));
      },
    } as unknown as ReturnType<typeof cp.spawn>);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    await copyIdWithPassword({
      host: 'mac-mini',
      user: 'rebin',
      port: 22,
      keyPath: '/tmp/id_test',
      password: 'secret',
    });

    const call = spawnSpy.mock.calls[0];
    expect(call[1]).not.toContain('secret');
    expect(call[1]?.join(' ')).toMatch(/-d/);
  });

  it('resolves with unknown when the child emits error', async () => {
    vi.spyOn(cp, 'spawn').mockReturnValue({
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: (event: string, cb: (arg: unknown) => void) => {
        if (event === 'error') queueMicrotask(() => cb(new Error('ENOENT')));
      },
    } as unknown as cp.ChildProcessWithoutNullStreams);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const result = await copyIdWithPassword({
      host: 'h', user: 'u', port: 22, keyPath: '/tmp/k', password: 'p',
    });
    expect(result).toEqual({ ok: false, code: 'unknown', stderr: 'ENOENT' });
  });

  it('classifies connection timed out as unreachable', async () => {
    vi.spyOn(cp, 'spawn').mockReturnValue({
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: {
        on: (_event: string, cb: (chunk: Buffer) => void) => {
          queueMicrotask(() => cb(Buffer.from('ssh: Connection timed out\n')));
        },
      },
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') queueMicrotask(() => cb(255));
      },
    } as unknown as cp.ChildProcessWithoutNullStreams);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const result = await copyIdWithPassword({
      host: 'h', user: 'u', port: 22, keyPath: '/tmp/k', password: 'p',
    });
    expect(result).toMatchObject({ ok: false, code: 'unreachable' });
  });

  it('does not double-resolve when error and close both fire', async () => {
    const closeSpy = vi.fn();
    vi.spyOn(cp, 'spawn').mockReturnValue({
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: (event: string, cb: (arg: unknown) => void) => {
        if (event === 'error') queueMicrotask(() => cb(new Error('ENOENT')));
        if (event === 'close') queueMicrotask(() => { closeSpy(); cb(null); });
      },
    } as unknown as cp.ChildProcessWithoutNullStreams);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const result = await copyIdWithPassword({
      host: 'h', user: 'u', port: 22, keyPath: '/tmp/k', password: 'p',
    });
    // error fires first, so the result is 'unknown' with the spawn error message
    expect(result).toEqual({ ok: false, code: 'unknown', stderr: 'ENOENT' });
    // close still fired (it's invoked by Node), but the settled guard kept it from changing the result
    expect(closeSpy).toHaveBeenCalled();
  });
});
