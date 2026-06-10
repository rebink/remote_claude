import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cp from 'node:child_process';
import { runVerifyKey } from '../../src/commands/setup.ts';

vi.mock('node:child_process');

afterEach(() => vi.restoreAllMocks());

function captureStdout(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;
  try { fn(); } finally { process.stdout.write = orig; }
  return writes.join('');
}

describe('setup --verify-key', () => {
  it('prints { ok: true } when ssh exits 0, using BatchMode', () => {
    const spy = vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 0, stdout: '', stderr: '' } as never);
    const out = captureStdout(() => runVerifyKey({ host: 'h', user: 'u', port: 2222, keyPath: '/k' }));
    expect(JSON.parse(out)).toEqual({ ok: true });
    const args = spy.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(['-o', 'BatchMode=yes', '-i', '/k', '-p', '2222', 'u@h', 'true']));
  });

  it('prints a structured failure when ssh exits non-zero', () => {
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 255, stdout: '', stderr: 'Permission denied (publickey).' } as never);
    const out = captureStdout(() => runVerifyKey({ host: 'h', user: 'u', port: 22, keyPath: '/k' }));
    const r = JSON.parse(out);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('verify_failed');
    expect(r.stderr).toMatch(/Permission denied/);
  });
});
