import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { CliEvent } from './events.ts';

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
    const emitter = new EventEmitter();
    const consume = parseJsonl((e) => emitter.emit('event', e));

    child.stdout!.on('data', (c: Buffer) => consume(c.toString()));
    let stderr = '';
    child.stderr!.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    const done = new Promise<number>((resolve) => {
      child.on('close', (code) => {
        if (stderr.trim()) {
          emitter.emit('event', {
            type: 'error',
            code: 'cli_stderr',
            message: stderr.trim(),
            recoverable: false,
          });
        }
        emitter.emit('end');
        resolve(code ?? -1);
      });
    });

    const events: AsyncIterable<CliEvent> = {
      [Symbol.asyncIterator]: async function* () {
        const queue: CliEvent[] = [];
        let ended = false;
        let waiter: (() => void) | null = null;
        emitter.on('event', (e) => {
          queue.push(e);
          waiter?.();
        });
        emitter.on('end', () => {
          ended = true;
          waiter?.();
        });
        while (!ended || queue.length) {
          if (queue.length) yield queue.shift()!;
          else await new Promise<void>((r) => (waiter = r));
        }
      },
    };

    return { events, cancel: () => child.kill('SIGTERM'), done };
  }
}
