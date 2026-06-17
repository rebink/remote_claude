// packages/core/src/session-command.test.ts
import { describe, it, expect } from 'vitest';
import { buildSessionShellCommand } from './session-command.ts';

const target = { project: 'app', host: '100.64.0.1', user: 'Admin', sshPort: 22, remotePath: '~/patchwire/box/app' };

describe('buildSessionShellCommand', () => {
  it('builds an ssh command running claude in a login interactive shell', () => {
    const cmd = buildSessionShellCommand(target, '/keys/k', false);
    expect(cmd).toBe(
      `ssh -tt -i '/keys/k' -p 22 -o StrictHostKeyChecking=accept-new Admin@100.64.0.1 'cd ~/patchwire/box/app && exec zsh -lic '\\''claude'\\'''`,
    );
  });
  it('adds --dangerously-skip-permissions when requested', () => {
    expect(buildSessionShellCommand(target, '/k', true)).toContain("claude --dangerously-skip-permissions");
  });
  it('contains no double quotes (osascript/shell safe)', () => {
    expect(buildSessionShellCommand(target, '/k', false).includes('"')).toBe(false);
  });
  it('defaults the port to 22 when unset', () => {
    const { sshPort, ...noPort } = target;
    expect(buildSessionShellCommand(noPort, '/k', false)).toContain('-p 22 ');
  });
  it('escapes single quotes in the key path', () => {
    expect(buildSessionShellCommand(target, "/a'b", false)).toContain("-i '/a'\\''b'");
  });
});
