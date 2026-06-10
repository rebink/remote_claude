import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WizardState } from './SetupWizard.ts';

// Stub vscode module before importing the wizard.
vi.mock('vscode', () => import('../test/vscode-stub.ts'));

// Mock node:fs to avoid real filesystem interactions during tests.
vi.mock('node:fs', () => ({
  existsSync: vi.fn((p: string) => {
    // local path /tmp/proj always exists; env file does not (so a token is generated)
    if (p === '/tmp/proj') return true;
    return false;
  }),
  statSync: vi.fn((_p: string) => ({ isDirectory: () => true })),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
}));

// Mock yaml so stringify is available
vi.mock('yaml', () => ({
  stringify: vi.fn(() => 'project: demo\n'),
}));

// Capture spawn calls.
const spawnCalls: { cmd: string; args: string[]; opts: unknown }[] = [];
let stubChild: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { write: () => void; end: () => void } };

function makeChild(stdoutLines: string[], exitCode: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: () => void; end: () => void };
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };

  // Override 'on' so that when the wizard registers its 'close' listener,
  // we schedule the flush. This avoids the race where setTimeout fires before
  // spawn is called and the listener is attached.
  const originalOn = child.on.bind(child);
  child.on = function (event: string, listener: (...args: unknown[]) => void) {
    const result = originalOn(event, listener);
    if (event === 'close') {
      // Flush stdout lines then emit close in the next microtask
      Promise.resolve().then(() => {
        for (const line of stdoutLines) child.stdout.emit('data', Buffer.from(line + '\n'));
        child.emit('close', exitCode);
      });
    }
    return result;
  } as typeof child.on;

  return child;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[], opts: unknown) => {
    spawnCalls.push({ cmd, args, opts });
    return stubChild;
  }),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '[]', stderr: '' })),
}));

beforeEach(() => {
  spawnCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SetupWizard step2 — terminal key install', () => {
  it('openKeyInstallTerminal opens a terminal running ssh-copy-id', async () => {
    const sent: string[] = [];
    const vscode = await import('../test/vscode-stub.ts');
    vi.spyOn(vscode.window, 'createTerminal').mockReturnValue({
      name: 't', show: () => {}, dispose: () => {},
      sendText: (t: string) => { sent.push(t); },
    } as never);

    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 2, host: 'mini', user: 'admin', sshPort: 22,
    };

    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'openKeyInstallTerminal',
      user: 'ana',
    });

    const joined = sent.join('\n');
    expect(joined).toMatch(/ssh-copy-id .* ana@/);
    expect(joined).toMatch(/ssh-keygen -t ed25519/);
  });

  it('verifyKey advances to step 3 when the CLI reports ok', async () => {
    stubChild = makeChild(['{"ok":true}'], 0);

    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 2, host: 'mini', user: 'admin', sshPort: 22, keyPath: '/home/admin/.patchwire/keys/mini-admin',
    };

    const posted: unknown[] = [];
    (wizard as unknown as { panel?: { webview: { postMessage: (m: unknown) => void } } }).panel = {
      webview: { postMessage: (m: unknown) => posted.push(m) },
    };

    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'verifyKey',
      user: 'ana',
    });

    const last = spawnCalls.at(-1)!;
    expect(last.args).toEqual(expect.arrayContaining(['setup', '--verify-key', '--key-path']));
    const stateAfter = (wizard as unknown as { state: WizardState }).state;
    expect(stateAfter.step).toBe(3);
  });
});

describe('SetupWizard step3Submit', () => {
  it('spawns patchwire init-remote --from-local --json with parsed inputs', async () => {
    stubChild = makeChild(
      [
        JSON.stringify({ type: 'step', name: 'probe', status: 'start' }),
        JSON.stringify({ type: 'step', name: 'probe', status: 'ok' }),
        JSON.stringify({ type: 'step', name: 'rsync', status: 'ok' }),
        JSON.stringify({ type: 'step', name: 'git_init', status: 'ok' }),
        JSON.stringify({ type: 'step', name: 'safety', status: 'ok' }),
        JSON.stringify({ type: 'done', ok: true, projectName: 'demo', remotePath: '~/workspace/demo' }),
      ],
      0,
    );

    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    // Prime state with completed Steps 1-2.
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 3,
      host: 'mini',
      user: 'admin',
      sshPort: 22,
      busy: false,
    };

    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'step3Submit',
      localPath: '/tmp/proj',
      projectName: 'demo',
    });

    // In the test environment extensionUri.fsPath is undefined → resolver falls back
    // to the bare 'patchwire' command; baseArgs is empty so the CLI args are unchanged.
    const call = spawnCalls.find((c) => c.args.includes('init-remote'));
    expect(call).toBeDefined();
    expect(call!.args).toContain('init-remote');
    expect(call!.args).toContain('--from-local');
    expect(call!.args).toContain('--project');
    expect(call!.args).toContain('demo');
    expect(call!.args).toContain('--json');
  });

  it('rejects an invalid project name before spawning', async () => {
    stubChild = makeChild([], 0);
    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 3, host: 'mini', user: 'admin', sshPort: 22, busy: false,
    };
    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'step3Submit',
      localPath: '/tmp/proj',
      projectName: '..',
    });
    expect(spawnCalls.length).toBe(0);
    expect(
      ((wizard as unknown as { state: { error?: string } }).state.error ?? '').toLowerCase(),
    ).toMatch(/project name|invalid/);
  });

  it('parses NDJSON progress and forwards step3Event to the webview', async () => {
    stubChild = makeChild(
      [
        JSON.stringify({ type: 'progress', stage: 'rsync', files: 100, bytes: 1024, pct: 50, current: 'a.txt' }),
        JSON.stringify({ type: 'done', ok: true, projectName: 'demo', remotePath: '~/workspace/demo' }),
      ],
      0,
    );
    const posted: unknown[] = [];
    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 3, host: 'mini', user: 'admin', sshPort: 22, busy: false,
    };
    (wizard as unknown as { panel?: { webview: { postMessage: (m: unknown) => void } } }).panel = {
      webview: { postMessage: (m: unknown) => posted.push(m) },
    };
    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'step3Submit',
      localPath: '/tmp/proj',
      projectName: 'demo',
    });
    const progressMsg = posted.find(
      (m) => typeof m === 'object' && m !== null && (m as { type?: string }).type === 'step3Event' &&
        ((m as { event?: { type?: string } }).event?.type === 'progress'),
    );
    expect(progressMsg).toBeDefined();
  });

  it('surfaces target_exists with a modal and re-spawns on Overwrite', async () => {
    let firstCall = true;
    stubChild = makeChild(
      [
        JSON.stringify({ type: 'step', name: 'probe', status: 'fail', code: 'target_exists' }),
        JSON.stringify({ type: 'done', ok: false }),
      ],
      4,
    );

    // After the modal, the next spawn returns happy events.
    const stubChildHappy = makeChild(
      [
        JSON.stringify({ type: 'step', name: 'safety', status: 'ok' }),
        JSON.stringify({ type: 'done', ok: true, projectName: 'demo', remotePath: '~/workspace/demo' }),
      ],
      0,
    );

    const cp = await import('node:child_process');
    (cp.spawn as unknown as { mockImplementation: (fn: (cmd: string, args: string[], opts: unknown) => unknown) => void }).mockImplementation(
      (cmd: string, args: string[], opts: unknown) => {
        spawnCalls.push({ cmd, args, opts });
        if (firstCall) { firstCall = false; return stubChild; }
        return stubChildHappy;
      },
    );

    const vscode = await import('vscode');
    (vscode.window as unknown as { showWarningMessage: unknown }).showWarningMessage =
      vi.fn().mockResolvedValue('Overwrite (rm -rf + re-push)') as never;

    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 3, host: 'mini', user: 'admin', sshPort: 22, busy: false,
    };

    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'step3Submit',
      localPath: '/tmp/proj',
      projectName: 'demo',
    });

    expect(spawnCalls.length).toBeGreaterThanOrEqual(2);
    expect(spawnCalls[1].args).toContain('--overwrite');
  });

  it('provisions the agent after a successful push, non-blocking on failure', async () => {
    // Push (init-remote) succeeds, then provision returns a failure JSON.
    // Queue two children: first for the push, second for the provision.
    const pushChild = makeChild(
      [
        JSON.stringify({ type: 'step', name: 'rsync', status: 'ok' }),
        JSON.stringify({ type: 'done', ok: true, projectName: 'demo', remotePath: '~/workspace/demo' }),
      ],
      0,
    );
    const provisionChild = makeChild(
      [JSON.stringify({ ok: false, code: 'install_failed', stderr: 'test error' })],
      1,
    );

    let callIndex = 0;
    const children = [pushChild, provisionChild];
    const cp = await import('node:child_process');
    (cp.spawn as unknown as { mockImplementation: (fn: (cmd: string, args: string[], opts: unknown) => unknown) => void }).mockImplementation(
      (cmd: string, args: string[], opts: unknown) => {
        spawnCalls.push({ cmd, args, opts });
        return children[callIndex++] ?? provisionChild;
      },
    );

    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({ fsPath: '/ext' } as never, output);
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 3, host: 'mini', user: 'admin', sshPort: 22,
      keyPath: '/home/admin/.patchwire/keys/mini-admin', busy: false,
    };

    const posted: unknown[] = [];
    (wizard as unknown as { panel?: { webview: { postMessage: (m: unknown) => void } } }).panel = {
      webview: { postMessage: (m: unknown) => posted.push(m) },
    };

    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'step3Submit',
      localPath: '/tmp/proj',
      projectName: 'demo',
    });

    // A second spawn with --provision-agent should have been made.
    const provision = spawnCalls.find((c) => c.args.includes('--provision-agent'));
    expect(provision).toBeTruthy();
    expect(provision!.args.join(' ')).toMatch(/--token [0-9a-f]+/);

    // Wizard still advanced to step 4 despite provision failure.
    const stateAfter = (wizard as unknown as { state: WizardState }).state;
    expect(stateAfter.step).toBe(4);
  });
});
