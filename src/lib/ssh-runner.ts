import { spawn } from 'node:child_process';

export interface SshOpts {
  host: string;
  user: string;
  port: number;
  keyPath: string;
  command: string;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnAdapter = (cmd: string, args: string[]) => Promise<SpawnResult>;

/** Single-quote a value for safe interpolation into a remote shell. Rejects newlines. */
export function quoteForShell(value: string): string {
  if (value.includes('\n')) {
    throw new Error('quoteForShell: newline in value not allowed');
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

const defaultAdapter: SpawnAdapter = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('error', (err) => {
      resolve({ code: null, stdout, stderr: stderr + `\nspawn error: ${err.message}` });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });

export async function runSsh(opts: SshOpts, adapter: SpawnAdapter = defaultAdapter): Promise<SpawnResult> {
  return adapter('ssh', buildSshArgv(opts));
}
