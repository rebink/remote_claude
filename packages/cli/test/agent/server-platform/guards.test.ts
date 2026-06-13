import { describe, it, expect } from 'vitest';
import { isEnforceable, summarizeCapabilities, assertEnforceable } from '../../../src/agent/server-platform/guards.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';

function platform(over: Partial<DetectedServerPlatform['capabilities']> = {}): DetectedServerPlatform {
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

describe('isEnforceable', () => {
  it('is true for a real impl and false for none', () => {
    expect(isEnforceable({ type: 'seatbelt', requiresElevation: false })).toBe(true);
    expect(isEnforceable({ type: 'none', requiresElevation: false })).toBe(false);
  });
});

describe('summarizeCapabilities', () => {
  it('includes an os line and marks a degraded security capability', () => {
    const lines = summarizeCapabilities(platform({ egress: { type: 'none', requiresElevation: false } }));
    expect(lines[0]).toMatch(/os: macos \(arm64, posix paths\)/);
    expect(lines.some((l) => /egress: none — NONE \(degraded/.test(l))).toBe(true);
  });
  it('marks capabilities that require elevation', () => {
    const lines = summarizeCapabilities(platform({ service: { type: 'systemd-system', requiresElevation: true } }));
    expect(lines.some((l) => /service: systemd-system \(requires elevation\)/.test(l))).toBe(true);
  });
});

describe('assertEnforceable', () => {
  it('throws fail-closed when the capability is none', () => {
    const p = platform({ egress: { type: 'none', requiresElevation: false } });
    expect(() => assertEnforceable(p, 'egress')).toThrow(/fail-closed/i);
  });
  it('passes when the capability has an impl', () => {
    expect(() => assertEnforceable(platform(), 'egress')).not.toThrow();
  });
});
