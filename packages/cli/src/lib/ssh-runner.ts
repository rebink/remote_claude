import { spawn } from 'node:child_process';

export interface SshOpts {
  host: string;
  user: string;
  port: number;
  keyPath: string;
  /**
   * The full remote shell command line, interpreted by the remote shell.
   * Shell metacharacters (&&, ;, $, `, |, etc.) are intentionally preserved
   * — callers MUST pre-quote any user-controlled values using `quoteForShell()`
   * before interpolating them into `command`. Do NOT pass raw user input.
   */
  command: string;
  /** Optional data piped to the remote command's stdin — keeps secrets off the argv (no ps leak). */
  input?: string;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnAdapter = (cmd: string, args: string[], input?: string) => Promise<SpawnResult>;

/** Single-quote a value for safe interpolation into a remote shell. Rejects newlines and carriage returns. */
export function quoteForShell(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error('quoteForShell: newline or carriage return in value not allowed');
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildSshArgv(opts: SshOpts): string[] {
  return [
    '-i', opts.keyPath,
    '-p', String(opts.port),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'BatchMode=yes',
    `${opts.user}@${opts.host}`,
    opts.command,
  ];
}

const defaultAdapter: SpawnAdapter = (cmd, args, input) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('error', (err) => {
      resolve({ code: null, stdout, stderr: stderr + `\nspawn error: ${err.message}` });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    if (input !== undefined && child.stdin) child.stdin.end(input);
  });

export async function runSsh(opts: SshOpts, adapter: SpawnAdapter = defaultAdapter): Promise<SpawnResult> {
  return adapter('ssh', buildSshArgv(opts), opts.input);
}
