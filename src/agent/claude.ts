import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { isNotLoggedIn, NOT_LOGGED_IN_REMEDIATION, tryDisableKeychainAutoLock } from './keychain.ts';

export interface ClaudeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function findClaude(command: string): { found: boolean; path?: string } {
  if (command.includes('/')) {
    if (existsSync(command)) return { found: true, path: command };
    return { found: false };
  }
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    try {
      const st = statSync(candidate);
      if (st.isFile()) return { found: true, path: candidate };
    } catch {
      // ignore
    }
  }
  return { found: false };
}

export function runClaude(opts: {
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
}): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (v: ClaudeResult) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const settleReject = (e: Error) => {
      if (settled) return;
      settled = true;
      reject(e);
    };

    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settleReject(new Error(`claude execution timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdin.on('error', (err: Error) => {
      // EPIPE if claude exits before we finish writing — surface as a process-level failure.
      clearTimeout(timer);
      settleReject(new Error(`claude stdin error: ${err.message}`));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      settleReject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      settleResolve({ stdout, stderr, exitCode: code ?? -1 });
    });

    child.stdin.end(opts.prompt);
  });
}

export function probeClaudeVersion(commandPath: string): string | undefined {
  const r = spawnSync(commandPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (r.status === 0 && r.stdout) return r.stdout.trim();
  return undefined;
}

/**
 * Streaming Claude runner used by `runChatTurn`. Constructed via {@link makeClaudeRunner}
 * with the configured binary path + base args. Resumes a Claude session by id
 * and streams stdout chunks via `onText`. Resolves when the child exits 0.
 */
export interface ClaudeStreamingOptions {
  bin: string;
  /** Base args; `--resume <sessionId>` is appended per call. */
  args: string[];
}

export function makeClaudeRunner(opts: ClaudeStreamingOptions) {
  return {
    async run(
      sessionId: string,
      prompt: string,
      onText: (chunk: string) => void,
    ): Promise<{ tokensIn: number; tokensOut: number }> {
      return new Promise<{ tokensIn: number; tokensOut: number }>((resolve, reject) => {
        let settled = false;
        const settleResolve = (v: { tokensIn: number; tokensOut: number }) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        const settleReject = (e: Error) => {
          if (settled) return;
          settled = true;
          reject(e);
        };

        // --session-id creates the session if it doesn't exist OR resumes it
        // if it does. --resume by contrast requires an EXISTING session and
        // fails for first-turn calls. Both flags require UUID format ids
        // (8-4-4-4-12 with dashes) — see lib/session-id.ts.
        const args = [...opts.args, '--session-id', sessionId];
        const child = spawn(opts.bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        child.stdin.on('error', (err: Error) =>
          settleReject(new Error(`claude stdin error: ${err.message}`)),
        );

        let out = '';
        child.stdout.on('data', (c: Buffer) => {
          const s = c.toString();
          out += s;
          onText(s);
        });
        child.on('error', (err: Error) => settleReject(err));
        child.on('close', (code) => {
          if (code === 0) {
            settleResolve({ tokensIn: 0, tokensOut: out.length });
            return;
          }
          // Auth-locked? Best-effort fix the keychain auto-lock setting (only
          // helps NEXT call — can't unlock a locked keychain without password)
          // and propagate a remediation message.
          if (isNotLoggedIn(out)) {
            tryDisableKeychainAutoLock();
            settleReject(new Error(`claude exited ${code} (auth-locked).\n${NOT_LOGGED_IN_REMEDIATION}`));
            return;
          }
          settleReject(new Error(`claude exited ${code}`));
        });

        child.stdin.write(prompt);
        child.stdin.end();
      });
    },
  };
}

/**
 * Env-based fallback runner used by tests / contexts without {@link AgentOptions}.
 *
 * Configurable via env:
 *   RC_CLAUDE_BIN  — path to the claude binary (default: "claude")
 *   RC_CLAUDE_ARGS — space-separated args (default: "--print")
 */
export const claudeRunner = makeClaudeRunner({
  bin: process.env.RC_CLAUDE_BIN || 'claude',
  args: process.env.RC_CLAUDE_ARGS?.split(' ').filter(Boolean) ?? ['--print'],
});
