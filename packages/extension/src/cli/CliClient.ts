import { spawn, type ChildProcess } from 'node:child_process';
import type { CliEvent } from '@patchwire/protocol';

export function parseJsonl(onEvent: (e: CliEvent) => void): (chunk: string) => void {
  let buf = '';
  return (chunk: string) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as CliEvent);
      } catch {
        /* malformed — skip */
      }
    }
  };
}

export interface SpawnResult {
  events: AsyncIterable<CliEvent>;
  cancel(): void;
  done: Promise<number>;
}

export class CliClient {
  constructor(
    private readonly cliPath: string,
    private readonly cwd: string,
  ) {}

  spawn(args: string[]): SpawnResult {
    const child: ChildProcess = spawn(this.cliPath, args, { cwd: this.cwd });

    // Eager buffering: events accumulate even before the consumer iterates.
    const queue: CliEvent[] = [];
    let ended = false;
    let waker: (() => void) | null = null;
    const wake = () => {
      const w = waker;
      waker = null;
      w?.();
    };

    const enqueue = (e: CliEvent) => {
      queue.push(e);
      wake();
    };
    const finish = () => {
      ended = true;
      wake();
    };

    const consume = parseJsonl(enqueue);
    let stderr = '';

    child.stdout?.on('data', (c: Buffer) => consume(c.toString()));
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    child.on('error', (err: Error) => {
      enqueue({
        type: 'error',
        code: 'cli_spawn_error',
        message: err.message,
        recoverable: false,
      });
      finish();
    });

    const done = new Promise<number>((resolve) => {
      child.on('close', (code) => {
        if (stderr.trim()) {
          enqueue({
            type: 'error',
            code: 'cli_stderr',
            message: stderr.trim(),
            recoverable: false,
          });
        }
        finish();
        resolve(code ?? -1);
      });
    });

    const events: AsyncIterable<CliEvent> = {
      [Symbol.asyncIterator]: async function* () {
        while (true) {
          if (queue.length) {
            yield queue.shift()!;
            continue;
          }
          if (ended) return;
          await new Promise<void>((r) => (waker = r));
        }
      },
    };

    return { events, cancel: () => child.kill('SIGTERM'), done };
  }
}
