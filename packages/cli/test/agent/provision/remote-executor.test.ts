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

describe('remoteExecutor — bootstrap-agent (binary installer)', () => {
  it('bootstrap-agent uses the binary installer when Node is absent and a binarySource is provided', async () => {
    const calls: string[] = [];
    const runner = async (cmd: string) => { calls.push(cmd); return { stdout: '', stderr: '', code: 0 }; };
    const source = async () => ({ bytes: Buffer.from('BIN'), sha256: 'a'.repeat(64), version: '1.0.0' });
    const exec = remoteExecutor(CONN, { ...detected('linux'), node: { present: false } }, { token: 't', binarySource: source, runner });
    const out = await exec(step('bootstrap-agent'));
    expect(out.result.ok).toBe(true);
    expect(calls.some((c) => c.includes('openssl base64 -A -d'))).toBe(true);
  });

  it('bootstrap-agent uses corepack (NOT binary) when Node is present, even with a binarySource', async () => {
    const calls: string[] = [];
    const runner = async (cmd: string) => { calls.push(cmd); return { stdout: '', stderr: '', code: 0 }; };
    const source = async () => ({ bytes: Buffer.from('BIN'), sha256: 'a'.repeat(64), version: '1.0.0' });
    const exec = remoteExecutor(CONN, { ...detected('linux'), node: { present: true } }, { token: 't', binarySource: source, runner });
    const out = await exec(step('bootstrap-agent'));
    expect(out.result.ok).toBe(true);
    expect(calls.some((c) => c.includes('openssl base64 -A -d'))).toBe(false);
    expect(calls.some((c) => c.includes('corepack enable') || c.includes('pnpm add -g'))).toBe(true);
  });

  it('bootstrap-agent uses corepack when Node is absent but no binarySource is configured', async () => {
    const calls: string[] = [];
    const runner = async (cmd: string) => { calls.push(cmd); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, { ...detected('linux'), node: { present: false } }, { token: 't', runner });
    const out = await exec(step('bootstrap-agent'));
    expect(out.result.ok).toBe(true);
    expect(calls.some((c) => c.includes('openssl base64 -A -d'))).toBe(false);
    expect(calls.some((c) => c.includes('corepack enable') || c.includes('pnpm add -g'))).toBe(true);
  });
});

describe('remoteExecutor — install-claude (probe)', () => {
  it('ok when the claude CLI is present', async () => {
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner: async () => ({ stdout: '', stderr: '', code: 0 }) });
    const out = await exec(step('install-claude'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
  });
  it('degraded (non-fatal) with a login hint when claude is absent', async () => {
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner: async () => ({ stdout: '', stderr: '', code: 1 }) });
    const out = await exec(step('install-claude'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBe(true);
    expect(out.result.detail).toMatch(/Claude Code|claude \/login/);
  });
});

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
    const out = await exec(step('does-not-exist'));
    expect(out.result).toEqual({ ok: true, degraded: true, detail: 'step "does-not-exist" not yet implemented' });
  });
});

describe('remoteExecutor — write-secret', () => {
  it('writes the FULL agent env (PW_AGENT_TOKEN + config) atomically to ~/.patchwire/agent.env via stdin', async () => {
    const calls: { command: string; input?: string }[] = [];
    const runner = async (command: string, input?: string) => {
      calls.push({ command, input });
      return { stdout: '', stderr: '', code: 0 };
    };
    const exec = remoteExecutor(CONN, detected('linux'), {
      token: 'TKN-123', host: '100.64.0.1', port: 7878, aiBin: 'claude',
      installer: fakeInstaller([]), runner,
    });
    const out = await exec(step('write-secret'));

    expect(out.result.ok).toBe(true);
    const w = calls[0]!;
    // Atomic temp→rename, mode 600, into ~/.patchwire/agent.env
    expect(w.command).toContain('umask 077');
    expect(w.command).toMatch(/cat > .*agent\.env\.tmp/);
    expect(w.command).toMatch(/mv -f .*agent\.env\.tmp.* .*\/\.patchwire\/agent\.env/);
    // The token is in stdin only, never in the command argv.
    expect(w.command).not.toContain('TKN-123');
    // Stdin payload carries the agent's env vars (PW_AGENT_TOKEN — NOT PW_TOKEN).
    expect(w.input).toContain(`export PW_AGENT_TOKEN=${quoteForShell('TKN-123')}`);
    expect(w.input).toContain(`export PW_AGENT_HOST=${quoteForShell('100.64.0.1')}`);
    expect(w.input).toContain(`export PW_AGENT_PORT=${quoteForShell('7878')}`);
    expect(w.input).toContain(`export PW_AI_BIN=${quoteForShell('claude')}`);
    expect(w.input).not.toContain('PW_TOKEN=');

    await out.compensate!();
    expect(calls[1]!.command).toMatch(/rm -f .*\/\.patchwire\/agent\.env/);
  });

  it('defaults host/port/aiBin when not provided', async () => {
    const calls: { command: string; input?: string }[] = [];
    const runner = async (command: string, input?: string) => { calls.push({ command, input }); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detected('macos'), { token: 't', installer: fakeInstaller([]), runner });
    await exec(step('write-secret'));
    expect(calls[0]!.input).toContain(`export PW_AGENT_HOST=${quoteForShell('127.0.0.1')}`);
    expect(calls[0]!.input).toContain(`export PW_AGENT_PORT=${quoteForShell('7878')}`);
    expect(calls[0]!.input).toContain(`export PW_AI_BIN=${quoteForShell('claude')}`);
  });

  it('write-secret reports failure (no compensate) on non-zero exit', async () => {
    const runner = async () => ({ stdout: '', stderr: 'denied', code: 1 });
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('write-secret'));
    expect(out.result.ok).toBe(false);
    expect(out.compensate).toBeUndefined();
  });
});

describe('remoteExecutor — install-mutagen', () => {
  it('is ok when mutagen is already present on the remote', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('install-mutagen'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
    expect(calls[0]).toMatch(/command -v mutagen|\.patchwire\/bin\/mutagen/);
  });

  it('is degraded (non-fatal) when mutagen is absent — the agent resolves it lazily', async () => {
    const runner = async () => ({ stdout: '', stderr: '', code: 1 });
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('install-mutagen'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBe(true);
    expect(out.result.detail).toMatch(/resolve|first sync/i);
  });
});

describe('remoteExecutor — install-service', () => {
  it('macOS: installs the launchd service via service-only patchwire-agent install, with compensate', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detected('macos'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('install-service'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
    expect(calls[0]).toMatch(/patchwire-agent install/);
    expect(calls[0]).not.toMatch(/--token/); // token lives in agent.env, not argv
    await out.compensate!();
    expect(calls[1]).toMatch(/patchwire-agent uninstall/);
  });

  it('macOS: reports failure (no compensate) on non-zero exit', async () => {
    const runner = async () => ({ stdout: '', stderr: 'launchctl failed', code: 1 });
    const exec = remoteExecutor(CONN, detected('macos'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('install-service'));
    expect(out.result.ok).toBe(false);
    expect(out.compensate).toBeUndefined();
  });

  it('Linux: installs the systemd --user service via patchwire-agent install, with compensate', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('install-service'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
    expect(calls[0]).toMatch(/patchwire-agent install/);
    await out.compensate!();
    expect(calls[1]).toMatch(/patchwire-agent uninstall/);
  });
});

function detectedWithEgress(os: DetectedServerPlatform['os'], egressType: string): DetectedServerPlatform {
  const d = detected(os);
  return { ...d, capabilities: { ...d.capabilities, egress: { type: egressType, requiresElevation: false } } };
}

describe('remoteExecutor — apply-egress', () => {
  it('sets PW_EGRESS=deny idempotently in agent.env when egress is enforceable', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detectedWithEgress('macos', 'seatbelt'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('apply-egress'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
    expect(calls[0]).toMatch(/agent\.env/);
    expect(calls[0]).toMatch(/PW_EGRESS=deny/);
    expect(calls[0]).toMatch(/grep -v .\^export PW_EGRESS=/); // idempotent: strips any prior line first
    expect(out.result.detail).toMatch(/seatbelt/);
    await out.compensate!();
    expect(calls[1]).toMatch(/grep -v .\^export PW_EGRESS=/); // compensate removes the line
    expect(calls[1]).not.toMatch(/PW_EGRESS=deny/);
  });

  it('degrades (warn) when egress is not enforceable — never sets deny on an unconfinable host', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detectedWithEgress('linux', 'none'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('apply-egress'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBe(true);
    expect(out.result.detail).toMatch(/not enforceable|without network confinement/i);
    expect(calls.length).toBe(0); // no env edit attempted
  });

  it('apply-egress reports failure (no compensate) on non-zero exit', async () => {
    const runner = async () => ({ stdout: '', stderr: 'mv failed', code: 1 });
    const exec = remoteExecutor(CONN, detectedWithEgress('macos', 'seatbelt'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('apply-egress'));
    expect(out.result.ok).toBe(false);
    expect(out.compensate).toBeUndefined();
  });
});

describe('remoteExecutor — bind-tailnet', () => {
  it('is ok when tailscale status succeeds', async () => {
    const calls: string[] = [];
    const runner = async (command: string) => { calls.push(command); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('bind-tailnet'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBeFalsy();
    expect(calls[0]).toMatch(/tailscale status/);
  });

  it('degrades with guidance when tailscale is not up', async () => {
    const runner = async () => ({ stdout: '', stderr: '', code: 1 });
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('bind-tailnet'));
    expect(out.result.ok).toBe(true);
    expect(out.result.degraded).toBe(true);
    expect(out.result.detail).toMatch(/tailscale up|tailnet/i);
  });
});
