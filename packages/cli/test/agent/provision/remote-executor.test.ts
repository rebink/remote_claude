import { describe, it, expect } from 'vitest';
import { remoteExecutor } from '../../../src/agent/provision/remote-executor.ts';
import type { AgentInstaller } from '../../../src/agent/provision/installer.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';
import { quoteForShell } from '../../../src/lib/ssh-runner.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

function detected(os: DetectedServerPlatform['os']): DetectedServerPlatform {
  return {
    os, arch: 'x64', pathStyle: os === 'windows' ? 'win' : 'posix',
    capabilities: {
      egress: { type: 'none', requiresElevation: false },
      filesystemIsolation: { type: 'none', requiresElevation: false },
      secrets: { type: 'file', requiresElevation: false },
      service: { type: 'none', requiresElevation: false },
      shell: { type: 'bash', requiresElevation: false },
      packageManager: { type: 'manual', requiresElevation: false },
    },
  };
}

const fakeInstaller = (calls: string[]): AgentInstaller => ({
  version: async () => null,
  check: async () => ({ present: false }),
  uninstall: async () => { calls.push('uninstall'); return { ok: true }; },
  install: async () => {
    calls.push('install');
    return { result: { ok: true, detail: 'installed' }, compensate: async () => { calls.push('compensate'); } };
  },
});

const step = (id: string) => ({ id, title: id, requiresElevation: false });

describe('remoteExecutor', () => {
  it('bootstrap-agent delegates to the injected AgentInstaller', async () => {
    const calls: string[] = [];
    const exec = remoteExecutor(CONN, detected('macos'), { token: 't', installer: fakeInstaller(calls) });
    const out = await exec(step('bootstrap-agent'));
    expect(out.result.ok).toBe(true);
    expect(calls).toEqual(['install']);
    expect(typeof out.compensate).toBe('function');
  });

  it('bootstrap-agent fails (fatal) on a Windows remote (not yet supported)', async () => {
    const exec = remoteExecutor(CONN, detected('windows'), { token: 't', installer: fakeInstaller([]) });
    const out = await exec(step('bootstrap-agent'));
    expect(out.result.ok).toBe(false);
    expect(out.result.detail).toMatch(/Windows/);
  });

  it('an unimplemented step completes as degraded (non-fatal)', async () => {
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]) });
    const out = await exec(step('install-mutagen'));
    expect(out.result).toEqual({ ok: true, degraded: true, detail: 'step "install-mutagen" not yet implemented' });
  });
});

describe('remoteExecutor — write-secret', () => {
  it('writes the token atomically via stdin, keeping it off the command argv', async () => {
    const calls: { command: string; input?: string }[] = [];
    const runner = async (command: string, input?: string) => {
      calls.push({ command, input });
      return { stdout: '', stderr: '', code: 0 };
    };
    const exec = remoteExecutor(CONN, detected('linux'), { token: 'TKN-123', installer: fakeInstaller([]), runner });
    const out = await exec(step('write-secret'));

    expect(out.result.ok).toBe(true);
    const write = calls[0]!;
    // Atomic temp→rename, mode 600 via umask, into ~/.patchwire/env
    expect(write.command).toContain('umask 077');
    expect(write.command).toContain('mkdir -p');
    expect(write.command).toMatch(/cat > .*env\.tmp/);
    expect(write.command).toMatch(/mv -f .*env\.tmp.*env/);
    // Token must NOT be in the command string (no ps leak).
    expect(write.command).not.toContain('TKN-123');
    expect(write.input).toBe(`export PW_TOKEN=${quoteForShell('TKN-123')}\n`);

    // compensate removes the secret file.
    await out.compensate!();
    expect(calls[1]!.command).toMatch(/rm -f .*\/\.patchwire\/env/);
  });

  it('write-secret reports failure (no compensate) on non-zero exit', async () => {
    const runner = async () => ({ stdout: '', stderr: 'denied', code: 1 });
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('write-secret'));
    expect(out.result.ok).toBe(false);
    expect(out.compensate).toBeUndefined();
  });
});
