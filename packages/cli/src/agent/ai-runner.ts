import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { isNotLoggedIn, NOT_LOGGED_IN_REMEDIATION, tryDisableKeychainAutoLock } from './keychain.ts';
import { parseAiUsage } from './usage-parser.ts';
import { wrapWithEgress } from './egress.ts';

export interface AiResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function findAiBin(command: string): { found: boolean; path?: string } {
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

/** Append Claude MCP-config flags when a per-session config path is provided. */
export function withMcpArgs(args: string[], mcpConfigPath?: string): string[] {
  if (!mcpConfigPath) return args;
  return [...args, '--mcp-config', mcpConfigPath, '--strict-mcp-config'];
}

export function runAi(opts: {
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
  /** When set, run the AI under a default-deny egress sandbox (seatbelt profile). */
  egressProfilePath?: string;
  /** When set, pass `--mcp-config <path> --strict-mcp-config` to the AI. */
  mcpConfigPath?: string;
}): Promise<AiResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (v: AiResult) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const settleReject = (e: Error) => {
      if (settled) return;
      settled = true;
      reject(e);
    };

    const effectiveArgs = withMcpArgs(opts.args, opts.mcpConfigPath);
    const run = opts.egressProfilePath
      ? wrapWithEgress(opts.command, effectiveArgs, opts.egressProfilePath)
      : { command: opts.command, args: effectiveArgs };
    const child = spawn(run.command, run.args, {
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
      settleReject(new Error(`AI command timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdin.on('error', (err: Error) => {
      // EPIPE if AI command exits before we finish writing — surface as a process-level failure.
      clearTimeout(timer);
      settleReject(new Error(`AI command stdin error: ${err.message}`));
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

export function probeAiVersion(commandPath: string): string | undefined {
  const r = spawnSync(commandPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (r.status === 0 && r.stdout) return r.stdout.trim();
  return undefined;
}

/**
 * Streaming AI runner used by `runChatTurn`. Constructed via {@link makeAiRunner}
 * with the configured binary path + base args. Resumes an AI session by id
 * and streams stdout chunks via `onText`. Resolves when the child exits 0.
 */
export interface AiStreamingOptions {
  bin: string;
  /** Base args; `--resume <sessionId>` is appended per call. */
  args: string[];
  /** When set, run the AI under a default-deny egress sandbox (seatbelt profile). */
  egressProfilePath?: string;
}

export function makeAiRunner(opts: AiStreamingOptions) {
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
        const run = opts.egressProfilePath
          ? wrapWithEgress(opts.bin, args, opts.egressProfilePath)
          : { command: opts.bin, args };
        const child = spawn(run.command, run.args, { stdio: ['pipe', 'pipe', 'pipe'] });

        child.stdin.on('error', (err: Error) =>
          settleReject(new Error(`AI command stdin error: ${err.message}`)),
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
            // Real token counts from the provider's output (Claude JSON/stream-json,
            // Aider text). Falls back to {0,0} for plain-text output — honest, unlike
            // the previous `out.length` character count. See usage-parser.ts.
            const usage = parseAiUsage(out);
            settleResolve({ tokensIn: usage.tokensIn, tokensOut: usage.tokensOut });
            return;
          }
          // Auth-locked? Best-effort fix the keychain auto-lock setting (only
          // helps NEXT call — can't unlock a locked keychain without password)
          // and propagate a remediation message.
          if (isNotLoggedIn(out)) {
            tryDisableKeychainAutoLock();
            settleReject(new Error(`AI command exited ${code} (auth-locked).\n${NOT_LOGGED_IN_REMEDIATION}`));
            return;
          }
          settleReject(new Error(`AI command exited ${code}`));
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
 *   PW_AI_BIN  — path to the AI binary (default: "claude")
 *   PW_AI_ARGS — space-separated args (default: "--print")
 */
export const aiRunner = makeAiRunner({
  bin: process.env.PW_AI_BIN || 'claude',
  args: process.env.PW_AI_ARGS?.split(' ').filter(Boolean) ?? ['--print'],
});
