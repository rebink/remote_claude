import { spawn } from 'node:child_process';

export interface VerifyResult {
  /** true iff the command exited 0. */
  passed: boolean;
  /** process exit code; 124 on timeout, -1 if it could not be spawned. */
  exitCode: number;
  durationMs: number;
  /** bounded tail (~64 KB) of combined stdout+stderr, for the developer to glance at. */
  output: string;
}

const MAX_OUTPUT = 64_000;

/**
 * Run an operator-configured verify command (e.g. `flutter analyze`, `npm test`)
 * on the agent's checkout *after* the AI's diff is captured but before it is
 * returned, so the developer reviews a diff that already passed validation.
 *
 * The command runs through a shell (it's a command line, not an argv), in `cwd`,
 * inheriting the agent's environment. Output is captured to a bounded tail.
 */
export function runVerify(command: string, cwd: string, timeoutMs: number): Promise<VerifyResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let out = '';
    const append = (b: Buffer) => {
      out += b.toString();
      if (out.length > MAX_OUTPUT) out = out.slice(-MAX_OUTPUT);
    };

    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ passed: false, exitCode: -1, durationMs: Date.now() - start, output: `verify spawn error: ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = timedOut ? 124 : code ?? -1;
      resolve({ passed: exitCode === 0, exitCode, durationMs: Date.now() - start, output: out.trimEnd() });
    });
  });
}
