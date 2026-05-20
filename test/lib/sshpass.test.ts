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
});
