import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cp from 'node:child_process';
import { buildAgentUnit, startSystemdUser } from '../../src/commands/daemon.ts';

vi.mock('node:child_process');

afterEach(() => vi.restoreAllMocks());

describe('buildAgentUnit', () => {
  it('sources env via shell (ExecStart uses /bin/sh -lc) and does NOT use EnvironmentFile', () => {
    const agentBin = '/usr/bin/patchwire-agent';
    const env = '/home/u/.patchwire/agent.env';
    const unit = buildAgentUnit(agentBin, env);

    expect(unit).toContain(`ExecStart=/bin/sh -lc '. /home/u/.patchwire/agent.env; exec /usr/bin/patchwire-agent serve'`);
    expect(unit).not.toContain('EnvironmentFile');
  });

  it('contains WantedBy=default.target and Restart=on-failure', () => {
    const unit = buildAgentUnit('/usr/bin/patchwire-agent', '/home/u/.patchwire/agent.env');
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).toContain('Restart=on-failure');
  });
});

describe('startSystemdUser', () => {
  it('happy path: calls daemon-reload + enable --now; returns ok=true', () => {
    const spy = vi.spyOn(cp, 'spawnSync').mockImplementation(() => ({ status: 0, stdout: '', stderr: '' } as never));

    const r = startSystemdUser();

    expect(r.ok).toBe(true);

    const calls = spy.mock.calls;
    const daemonReloadCall = calls.find(([cmd, args]) => cmd === 'systemctl' && (args as string[]).includes('daemon-reload'));
    expect(daemonReloadCall).toBeDefined();
    expect(daemonReloadCall![1]).toEqual(['--user', 'daemon-reload']);

    const enableCall = calls.find(([cmd, args]) => cmd === 'systemctl' && (args as string[]).includes('enable'));
    expect(enableCall).toBeDefined();
    expect(enableCall![1]).toEqual(['--user', 'enable', '--now', 'patchwire-agent.service']);
  });

  it('enable fails: returns ok=false with stderr', () => {
    vi.spyOn(cp, 'spawnSync').mockImplementation((_cmd, args) => {
      if ((args as string[]).includes('enable')) {
        return { status: 1, stdout: '', stderr: 'boom' } as never;
      }
      return { status: 0, stdout: '', stderr: '' } as never;
    });

    const r = startSystemdUser();

    expect(r.ok).toBe(false);
    expect(r.stderr).toContain('boom');
  });

  it('loginctl enable-linger failure does NOT flip ok to false (non-fatal)', () => {
    vi.spyOn(cp, 'spawnSync').mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (_cmd === 'loginctl') return { status: 1, stdout: '', stderr: 'no permission' } as never;
      if (a.includes('enable')) return { status: 0, stdout: '', stderr: '' } as never;
      return { status: 0, stdout: '', stderr: '' } as never;
    });

    const r = startSystemdUser();

    expect(r.ok).toBe(true);
  });
});
