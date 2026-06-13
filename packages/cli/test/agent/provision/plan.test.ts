import { describe, it, expect } from 'vitest';
import { planProvision, elevationRequired } from '../../../src/agent/provision/plan.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';

function detected(over: Partial<DetectedServerPlatform['capabilities']> = {}): DetectedServerPlatform {
  return {
    os: 'macos',
    arch: 'arm64',
    pathStyle: 'posix',
    capabilities: {
      egress: { type: 'seatbelt', requiresElevation: false },
      filesystemIsolation: { type: 'seatbelt', requiresElevation: false },
      secrets: { type: 'keychain', requiresElevation: false },
      service: { type: 'launchd', requiresElevation: false },
      shell: { type: 'zsh', requiresElevation: false },
      packageManager: { type: 'brew', requiresElevation: false },
      ...over,
    },
  };
}

describe('planProvision', () => {
  it('produces the ordered steps for a macOS host with no elevation', () => {
    const plan = planProvision(detected());
    expect(plan.steps.map((s) => s.id)).toEqual([
      'install-claude', 'install-mutagen', 'write-secret', 'install-service', 'apply-egress', 'bind-tailnet',
    ]);
    expect(plan.steps.every((s) => s.requiresElevation === false)).toBe(true);
  });

  it('marks elevation from capabilities (linux: apt + nftables)', () => {
    const plan = planProvision(detected({
      packageManager: { type: 'apt', requiresElevation: true },
      egress: { type: 'nftables', requiresElevation: true },
      service: { type: 'systemd-user', requiresElevation: false },
    }));
    const byId = Object.fromEntries(plan.steps.map((s) => [s.id, s.requiresElevation]));
    expect(byId['install-claude']).toBe(true);
    expect(byId['apply-egress']).toBe(true);
    expect(byId['install-service']).toBe(false);
  });

  it('elevationRequired returns only the elevated steps', () => {
    const plan = planProvision(detected({ egress: { type: 'nftables', requiresElevation: true } }));
    expect(elevationRequired(plan).map((s) => s.id)).toEqual(['apply-egress']);
  });
});
