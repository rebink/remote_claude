import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerify } from '../src/agent/verify-runner.ts';

describe('runVerify', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-verify-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports passed=true with exit 0 for a successful command', async () => {
    const res = await runVerify('exit 0', dir, 10_000);
    expect(res.passed).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports passed=false and the real exit code for a failing command', async () => {
    const res = await runVerify('exit 3', dir, 10_000);
    expect(res.passed).toBe(false);
    expect(res.exitCode).toBe(3);
  });

  it('captures stdout and stderr into output', async () => {
    const res = await runVerify('echo hello-out; echo hello-err 1>&2; exit 1', dir, 10_000);
    expect(res.output).toContain('hello-out');
    expect(res.output).toContain('hello-err');
  });

  it('runs the command in the given cwd', async () => {
    writeFileSync(join(dir, 'marker.txt'), 'ok');
    const res = await runVerify('cat marker.txt', dir, 10_000);
    expect(res.passed).toBe(true);
    expect(res.output).toContain('ok');
  });

  it('kills and reports exit 124 on timeout', async () => {
    const res = await runVerify('sleep 5', dir, 200);
    expect(res.passed).toBe(false);
    expect(res.exitCode).toBe(124);
  });

  it('truncates very large output to a bounded tail', async () => {
    // print ~200k of output; result.output must stay bounded
    const res = await runVerify('for i in $(seq 1 20000); do echo "line $i"; done', dir, 10_000);
    expect(res.output.length).toBeLessThanOrEqual(70_000);
    expect(res.output).toContain('line 20000'); // keeps the TAIL
  });
});
