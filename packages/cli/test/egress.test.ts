import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mergeAllowHosts,
  buildSeatbeltProfile,
  wrapWithEgress,
  egressAvailable,
  ANTHROPIC_DEFAULT_HOSTS,
} from '../src/agent/egress.ts';
import { runAi } from '../src/agent/ai-runner.ts';

describe('mergeAllowHosts', () => {
  it('returns the Anthropic defaults when no extra hosts are given', () => {
    expect(mergeAllowHosts('')).toEqual(ANTHROPIC_DEFAULT_HOSTS);
    expect(mergeAllowHosts(undefined)).toEqual(ANTHROPIC_DEFAULT_HOSTS);
  });

  it('adds operator hosts split on commas or whitespace, deduped', () => {
    const out = mergeAllowHosts('registry.npmjs.org, pub.dev   pub.dev');
    expect(out).toContain('api.anthropic.com');
    expect(out).toContain('registry.npmjs.org');
    expect(out).toContain('pub.dev');
    // deduped
    expect(out.filter((h) => h === 'pub.dev')).toHaveLength(1);
  });

  it('ignores empty tokens from messy separators', () => {
    expect(mergeAllowHosts(' , ,  ')).toEqual(ANTHROPIC_DEFAULT_HOSTS);
  });
});

describe('buildSeatbeltProfile', () => {
  it('denies outbound network by default and re-allows each allowlist IP on 443', () => {
    const p = buildSeatbeltProfile({ allowIps: ['1.2.3.4', '5.6.7.8'], allowDns: true });
    expect(p).toContain('(deny network-outbound)');
    expect(p).toContain('(allow network-outbound (remote ip "1.2.3.4:443"))');
    expect(p).toContain('(allow network-outbound (remote ip "5.6.7.8:443"))');
    // localhost + unix sockets always allowed so local IPC/keychain still work
    expect(p).toMatch(/localhost/);
    expect(p).toContain('unix-socket');
    // the deny must come before the allowlist re-allows
    expect(p.indexOf('(deny network-outbound)')).toBeLessThan(p.indexOf('1.2.3.4:443'));
  });

  it('includes a DNS allow rule only when allowDns is true', () => {
    expect(buildSeatbeltProfile({ allowIps: [], allowDns: true })).toContain(':53');
    expect(buildSeatbeltProfile({ allowIps: [], allowDns: false })).not.toContain(':53');
  });

  it('starts with the seatbelt version header and allow-default base', () => {
    const p = buildSeatbeltProfile({ allowIps: [], allowDns: true });
    expect(p.trimStart().startsWith('(version 1)')).toBe(true);
    expect(p).toContain('(allow default)');
  });
});

describe('wrapWithEgress', () => {
  it('rewrites the spawn to run the command under sandbox-exec with the profile', () => {
    const w = wrapWithEgress('claude', ['--print', '--output-format', 'json'], '/tmp/egress.sb');
    expect(w.command).toBe('sandbox-exec');
    expect(w.args).toEqual(['-f', '/tmp/egress.sb', 'claude', '--print', '--output-format', 'json']);
  });

  it('preserves an absolute claude path and empty args', () => {
    const w = wrapWithEgress('/usr/local/bin/claude', [], '/p.sb');
    expect(w.args).toEqual(['-f', '/p.sb', '/usr/local/bin/claude']);
  });
});

// macOS-only: proves runAi actually executes the command *through* sandbox-exec.
// Skipped on Linux CI (no sandbox-exec). Uses a fully-permissive profile — this
// validates the wrapper path, not the network-deny enforcement (that's the
// on-box `egress-check`).
describe.skipIf(!egressAvailable())('runAi under a seatbelt profile (macOS)', () => {
  it('runs the AI command wrapped in sandbox-exec', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-egress-int-'));
    try {
      const bin = join(dir, 'fake-ai.sh');
      writeFileSync(bin, "#!/bin/sh\ncat > /dev/null\nprintf 'ran-under-sandbox'\n", 'utf8');
      chmodSync(bin, 0o755);
      const profile = join(dir, 'egress.sb');
      writeFileSync(profile, buildSeatbeltProfile({ allowIps: [], allowDns: true }) + '(allow network*)\n');

      const res = await runAi({ command: bin, args: [], prompt: 'hi', cwd: dir, timeoutMs: 10_000, egressProfilePath: profile });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toBe('ran-under-sandbox');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
