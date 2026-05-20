import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

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
      reject(new Error(`claude execution timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
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
        const args = [...opts.args, '--resume', sessionId];
        const child = spawn(opts.bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        let out = '';
        child.stdout.on('data', (c: Buffer) => {
          const s = c.toString();
          out += s;
          onText(s);
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve({ tokensIn: 0, tokensOut: out.length });
          else reject(new Error(`claude exited ${code}`));
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
