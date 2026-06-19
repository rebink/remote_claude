import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { parseServicesLine, reduceServices, initialServices, type ServicesView } from './protocol.ts';

export interface SpawnedChild {
  stdout: { on(ev: 'data', cb: (chunk: Buffer | string) => void): void } | null;
  stdin: { write(s: string): void } | null;
  on(ev: 'exit', cb: (code: number | null) => void): void;
  kill(): void;
}

export type CliSpawn = (command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => SpawnedChild;

const defaultSpawn: CliSpawn = (command, args, opts) =>
  spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as SpawnedChild;

/** Drives one `patchwire services serve --stream` session for the workspace. */
export class ServicesController {
  private statusEmitter = new vscode.EventEmitter<ServicesView>();
  readonly onDidChange = this.statusEmitter.event;
  private view: ServicesView = initialServices;
  private child: SpawnedChild | null = null;
  private buf = '';

  constructor(
    private readonly command: string,
    private readonly baseArgs: string[],
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly spawnFn: CliSpawn = defaultSpawn,
  ) {}

  start(): void {
    if (this.child) return;
    const child = this.spawnFn(this.command, [...this.baseArgs, 'services', 'serve', '--stream'], { cwd: this.cwd, env: this.env });
    this.child = child;
    child.stdout?.on('data', (chunk) => this.onData(chunk.toString()));
    child.on('exit', () => {
      this.child = null;
      this.view = { ...this.view, error: 'session stopped' };
      this.statusEmitter.fire(this.view);
    });
  }

  private onData(text: string): void {
    this.buf += text;
    let nl = this.buf.indexOf('\n');
    while (nl >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const ev = parseServicesLine(line);
      if (ev) {
        this.view = reduceServices(this.view, ev);
        this.statusEmitter.fire(this.view);
      }
      nl = this.buf.indexOf('\n');
    }
  }

  send(cmd: Record<string, unknown>): void {
    this.child?.stdin?.write(JSON.stringify(cmd) + '\n');
  }
  discover(): void { this.send({ cmd: 'discover' }); }
  bind(id: string): void { this.send({ cmd: 'bind', id }); }
  unbind(id: string): void { this.send({ cmd: 'unbind', id }); }
  retry(id: string): void { this.send({ cmd: 'retry', id }); }

  current(): ServicesView { return this.view; }
  isRunning(): boolean { return this.child !== null; }

  stop(): void { this.child?.kill(); this.child = null; }
  dispose(): void { this.stop(); this.statusEmitter.dispose(); }
}
