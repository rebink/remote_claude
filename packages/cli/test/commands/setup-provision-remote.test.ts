import { describe, it, expect, vi, afterEach } from 'vitest';

// No real SSH, fs, or network calls needed — provision is fully injected.
vi.mock('undici', () => ({ fetch: vi.fn(async () => ({ ok: true })) }));

afterEach(() => vi.restoreAllMocks());

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const writes: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;
  return fn().finally(() => { process.stdout.write = orig; }).then(() => writes.join(''));
}

const TOKEN = 'a1b2c3d4e5f60718293a4b5c'; // valid: hex-ish, ≥16 chars

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeProvision(impl: (conn: any, opts: any, deps: any) => Promise<any>) { return impl as any; }

describe('setup --provision-remote', () => {
  it('json + yes → completed result emitted to stdout', async () => {
    const completedResult = {
      status: 'completed' as const,
      detected: { os: 'linux' },
      plan: { steps: [] },
      outcome: { status: 'completed', degraded: [] },
      health: { tailnet: true, agent: 'healthy' as const },
    };

    const provision = fakeProvision(async (_conn, _opts, deps) => {
      // confirm should return true when yes:true
      const confirmed = await deps.confirm({ steps: [] }, []);
      expect(confirmed).toBe(true);
      return completedResult;
    });

    const { runProvisionRemote } = await import('../../src/commands/setup.ts');
    const out = await captureStdout(() =>
      runProvisionRemote(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN, yes: true, json: true },
        { provision },
      ),
    );

    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      status: 'completed',
      detected: { os: 'linux' },
      plan: { steps: [] },
      outcome: { status: 'completed', degraded: [] },
      health: { tailnet: true, agent: 'healthy' },
    });
  });

  it('json + NOT yes → confirm returns false → cancelled status emitted', async () => {
    const cancelledResult = {
      status: 'cancelled' as const,
      detected: { os: 'linux' },
      plan: { steps: [{ id: 'x', title: 'X', requiresElevation: false }] },
    };

    const provision = fakeProvision(async (_conn, _opts, deps) => {
      // confirm should return false when yes:false and json:true (non-TTY)
      const confirmed = await deps.confirm(
        { steps: [{ id: 'x', title: 'X', requiresElevation: false }] },
        [],
      );
      expect(confirmed).toBe(false);
      return cancelledResult;
    });

    const { runProvisionRemote } = await import('../../src/commands/setup.ts');
    const out = await captureStdout(() =>
      runProvisionRemote(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN, yes: false, json: true },
        { provision },
      ),
    );

    const parsed = JSON.parse(out);
    expect(parsed.status).toBe('cancelled');
  });

  it('invalid input guard: unsafe host → emits error JSON without calling provision', async () => {
    const provisionSpy = vi.fn().mockRejectedValue(new Error('should not be called'));

    const { runProvisionRemote } = await import('../../src/commands/setup.ts');
    const out = await captureStdout(() =>
      runProvisionRemote(
        { host: 'h; rm -rf ~', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN },
        { provision: provisionSpy as any },
      ),
    );

    expect(JSON.parse(out)).toEqual({
      ok: false,
      code: 'invalid_input',
      stderr: 'Refusing to provision: unsafe host.',
    });
    expect(provisionSpy).not.toHaveBeenCalled();
  });

  it('human progress: onEvent calls are invoked and function completes', async () => {
    // Spy on the log module to capture human-mode output without fragile stdout capture
    const logModule = await import('../../src/lib/log.ts');
    const infoSpy = vi.spyOn(logModule.log, 'info');
    const warnSpy = vi.spyOn(logModule.log, 'warn');
    const okSpy = vi.spyOn(logModule.log, 'ok');

    const provision = fakeProvision(async (_conn, _opts, deps) => {
      // Trigger preview event
      deps.onEvent({
        type: 'preview',
        plan: { steps: [{ id: 'install-claude', title: 'Install Claude', requiresElevation: false }] },
        elevation: [],
      });
      // Trigger step start
      deps.onEvent({ type: 'step', step: 'install-claude', status: 'start' });
      // Trigger step ok
      deps.onEvent({ type: 'step', step: 'install-claude', status: 'ok', detail: 'done' });
      // Trigger degraded step
      deps.onEvent({ type: 'step', step: 'apply-egress', status: 'degraded', detail: 'warn-only' });

      return {
        status: 'completed' as const,
        health: { tailnet: true, agent: 'healthy' as const },
      };
    });

    const { runProvisionRemote } = await import('../../src/commands/setup.ts');
    await runProvisionRemote(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN, yes: true, json: false },
      { provision },
    );

    // Check that install-claude appeared in info calls
    const infoCalls = infoSpy.mock.calls.map((c) => c[0]);
    expect(infoCalls.some((msg) => msg.includes('install-claude'))).toBe(true);

    // Check degraded marker in warn calls
    const warnCalls = warnSpy.mock.calls.map((c) => c[0]);
    expect(warnCalls.some((msg) => msg.includes('apply-egress') || msg.includes('degraded') || msg.includes('warn-only'))).toBe(true);

    // Check health summary in info or ok calls
    const allInfoCalls = infoCalls;
    expect(allInfoCalls.some((msg) => msg.includes('tailnet') && msg.includes('up'))).toBe(true);

    // Check completed was surfaced via log.ok
    const okCalls = okSpy.mock.calls.map((c) => c[0]);
    expect(okCalls.some((msg) => msg.includes('provisioning completed'))).toBe(true);
  });
});
