import { describe, it, expect } from 'vitest';
import { quoteForShell, buildSshArgv, runSsh } from '../../src/lib/ssh-runner.ts';

describe('quoteForShell', () => {
  it('wraps a simple value in single quotes', () => {
    expect(quoteForShell('hello')).toBe("'hello'");
  });

  it('escapes single quotes inside the value', () => {
    expect(quoteForShell("it's")).toBe(`'it'\\''s'`);
  });

  it('rejects newlines (no legitimate use case for ssh payloads)', () => {
    expect(() => quoteForShell('a\nb')).toThrow(/newline/);
  });

  it('rejects carriage returns', () => {
    expect(() => quoteForShell('a\rb')).toThrow(/newline or carriage return/);
  });
});

describe('buildSshArgv', () => {
  it('composes -i, -p, -o flags and the remote command', () => {
    const argv = buildSshArgv({
      host: 'mini.tail.ts.net',
      user: 'admin',
      port: 22,
      keyPath: '/k/key',
      command: 'echo hi',
    });
    expect(argv).toEqual([
      '-i', '/k/key',
      '-p', '22',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      'admin@mini.tail.ts.net',
      'echo hi',
    ]);
  });

  it('always includes -p flag, even for port 22', () => {
    const argv = buildSshArgv({
      host: 'h', user: 'u', port: 22, keyPath: '/k', command: 'ls',
    });
    expect(argv).toContain('-p');
    expect(argv).toContain('22');
  });
});

describe('runSsh', () => {
  it('returns code/stdout/stderr from the injected adapter', async () => {
    const captured: { cmd?: string; args?: string[] } = {};
    const adapter = async (cmd: string, args: string[]) => {
      captured.cmd = cmd;
      captured.args = args;
      return { code: 0, stdout: 'ok\n', stderr: '' };
    };
    const result = await runSsh(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', command: 'ls' },
      adapter,
    );
    expect(captured.cmd).toBe('ssh');
    expect(captured.args?.at(-1)).toBe('ls');
    expect(result).toEqual({ code: 0, stdout: 'ok\n', stderr: '' });
  });

  it('propagates non-zero exits without throwing', async () => {
    const adapter = async () => ({ code: 5, stdout: '', stderr: 'boom' });
    const r = await runSsh(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', command: 'false' },
      adapter,
    );
    expect(r).toEqual({ code: 5, stdout: '', stderr: 'boom' });
  });

  it('defaultAdapter: returns code:null and stderr containing "spawn error" when ssh cannot be found', async () => {
    const origPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const r = await runSsh({ host: 'h', user: 'u', port: 22, keyPath: '/k', command: 'true' });
      expect(r.code).toBeNull();
      expect(r.stderr).toMatch(/spawn error/);
    } finally {
      process.env.PATH = origPath;
    }
  });
});

describe('runSsh stdin', () => {
  it('forwards opts.input to the adapter as the third argument', async () => {
    let received: { args: string[]; input?: string } | undefined;
    const adapter = async (_cmd: string, args: string[], input?: string) => {
      received = { args, input };
      return { code: 0, stdout: '', stderr: '' };
    };
    await runSsh(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', command: 'cat > f', input: 'SECRET-DATA' },
      adapter,
    );
    expect(received?.input).toBe('SECRET-DATA');
    // The command (argv) must NOT contain the secret — it travels via stdin only.
    expect(received?.args.join(' ')).not.toContain('SECRET-DATA');
  });
});
