import { describe, it, expect } from 'vitest';
import { provisionRemote } from '../../../src/agent/provision/provision-remote.ts';
import type { ProvisionRemoteDeps, HealthReport } from '../../../src/agent/provision/provision-remote.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';
import type { StepExecutor } from '../../../src/agent/provision/types.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

function detected(os: DetectedServerPlatform['os'] = 'macos'): DetectedServerPlatform {
  return {
    os, arch: 'arm64', pathStyle: os === 'windows' ? 'win' : 'posix',
    capabilities: {
      egress: { type: 'seatbelt', requiresElevation: false },
      filesystemIsolation: { type: 'seatbelt', requiresElevation: false },
      secrets: { type: 'keychain', requiresElevation: false },
      service: { type: 'launchd', requiresElevation: false },
      shell: { type: 'zsh', requiresElevation: false },
      packageManager: { type: 'brew', requiresElevation: false },
    },
  };
}

const HEALTHY: HealthReport = { tailnet: true, agent: 'healthy' };
const okExecutor: StepExecutor = async () => ({ result: { ok: true } });

function baseDeps(over: Partial<ProvisionRemoteDeps> = {}): ProvisionRemoteDeps {
  return {
    detect: async () => detected(),
    makeExecutor: () => okExecutor,
    verify: async () => HEALTHY,
    ...over,
  };
}

describe('provisionRemote', () => {
  it('runs detect→plan→preview→execute→verify and returns completed with health', async () => {
    const events: { type: string }[] = [];
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({ onEvent: (e) => events.push(e) }));
    expect(res.status).toBe('completed');
    expect(res.detected?.os).toBe('macos');
    expect(res.plan?.steps.length).toBeGreaterThan(0);
    expect(res.health).toEqual(HEALTHY);
    expect(events.some((e) => e.type === 'preview')).toBe(true);
  });

  it('cancels (no execution, no verify) when confirm declines', async () => {
    let executed = false;
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({
      makeExecutor: () => async () => { executed = true; return { result: { ok: true } }; },
      confirm: () => false,
      verify: async () => { throw new Error('verify must not run on cancel'); },
    }));
    expect(res.status).toBe('cancelled');
    expect(executed).toBe(false);
    expect(res.health).toBeUndefined();
  });

  it('proceeds when confirm approves, passing the elevation list', async () => {
    let sawElevation: unknown;
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({
      confirm: (_plan, elevation) => { sawElevation = elevation; return true; },
    }));
    expect(res.status).toBe('completed');
    expect(Array.isArray(sawElevation)).toBe(true);
  });

  it('returns rolled-back and does NOT verify when a step fails', async () => {
    const failing: StepExecutor = async (s) => (s.id === 'write-secret' ? { result: { ok: false, detail: 'boom' } } : { result: { ok: true } });
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({
      makeExecutor: () => failing,
      verify: async () => { throw new Error('verify must not run on rollback'); },
    }));
    expect(res.status).toBe('rolled-back');
    expect(res.outcome?.failedStep).toBe('write-secret');
    expect(res.health).toBeUndefined();
  });

  it('aggregates degraded steps into the outcome', async () => {
    const degrading: StepExecutor = async (s) => (s.id === 'apply-egress' ? { result: { ok: true, degraded: true, detail: 'egress warn-only' } } : { result: { ok: true } });
    const res = await provisionRemote(CONN, { token: 't' }, baseDeps({ makeExecutor: () => degrading }));
    expect(res.status).toBe('completed');
    expect(res.outcome?.degraded).toContain('egress warn-only');
  });
});
