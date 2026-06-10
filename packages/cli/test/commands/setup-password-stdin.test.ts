import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSetupPasswordStdin } from '../../src/commands/setup.ts';
import * as sshpass from '../../src/lib/sshpass.ts';
import * as fs from 'node:fs';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual };
});

describe('setup --password-stdin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads password from stdin, calls copyIdWithPassword, zeroes buffer, prints JSON result', async () => {
    const copySpy = vi.spyOn(sshpass, 'copyIdWithPassword').mockResolvedValue({ ok: true });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const stdin = new (await import('node:stream')).PassThrough();
    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });

    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: unknown) => {
      writes.push(String(c));
      return true;
    }) as typeof process.stdout.write;

    const run = runSetupPasswordStdin({
      host: 'mac-mini',
      user: 'rebin',
      port: 22,
      keyPath: '/tmp/id_test',
    });

    stdin.write('hunter2\n');
    stdin.end();

    try {
      await run;
    } finally {
      process.stdout.write = origWrite;
      Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    }

    expect(copySpy).toHaveBeenCalledWith(expect.objectContaining({ password: 'hunter2' }));
    expect(JSON.parse(writes.join(''))).toEqual({ ok: true });
  });

  it('rejects with structured error when --key-path is empty', async () => {
    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;

    await runSetupPasswordStdin({ host: 'h', user: 'u', port: 22, keyPath: '' });

    process.stdout.write = origWrite;
    expect(JSON.parse(writes.join(''))).toEqual({
      ok: false,
      code: 'unknown',
      stderr: '--key-path is required',
    });
  });

  it('strips trailing \\r\\n from the password', async () => {
    const copySpy = vi.spyOn(sshpass, 'copyIdWithPassword').mockResolvedValue({ ok: true });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const stdin = new (await import('node:stream')).PassThrough();
    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });

    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;

    const run = runSetupPasswordStdin({ host: 'h', user: 'u', port: 22, keyPath: '/tmp/id_test' });

    stdin.write('hunter2\r\n');
    stdin.end();

    try {
      await run;
    } finally {
      process.stdout.write = origWrite;
      Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    }

    expect(copySpy).toHaveBeenCalledWith(expect.objectContaining({ password: 'hunter2' }));
  });

  it('emits a structured sshpass_missing result instead of crashing when sshpass is absent', async () => {
    vi.spyOn(sshpass, 'copyIdWithPassword').mockRejectedValue(
      new Error('sshpass not found. Install with: brew install hudochenkov/sshpass/sshpass (macOS) or apt-get install sshpass (Linux).'),
    );
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const stdin = new (await import('node:stream')).PassThrough();
    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });

    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;

    const run = runSetupPasswordStdin({ host: 'h', user: 'u', port: 22, keyPath: '/tmp/id_test' });
    stdin.write('hunter2\n');
    stdin.end();

    try {
      await run;
    } finally {
      process.stdout.write = origWrite;
      Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    }

    const out = JSON.parse(writes.join(''));
    expect(out.ok).toBe(false);
    expect(out.code).toBe('sshpass_missing');
    expect(out.stderr).toMatch(/sshpass not found/);
  });
});
