import { describe, it, expect } from 'vitest';
import { buildRemoteCommand, type SessionTarget } from './sessionTerminal.ts';

const target: SessionTarget = {
  project: 'myapp',
  host: 'mini.local',
  user: 'alice',
  remotePath: '~/workspace/alice/myapp',
};

describe('buildRemoteCommand', () => {
  it('launches plain claude when skipPermissions is false', () => {
    const cmd = buildRemoteCommand(target, false);
    expect(cmd).toContain('cd ~/workspace/alice/myapp');
    expect(cmd).toContain(`exec zsh -lic 'claude'`);
    expect(cmd).not.toContain('--dangerously-skip-permissions');
    expect(cmd).not.toContain('permissions bypassed');
  });

  it('adds the flag and a warning banner when skipPermissions is true', () => {
    const cmd = buildRemoteCommand(target, true);
    expect(cmd).toContain(`exec zsh -lic 'claude --dangerously-skip-permissions'`);
    expect(cmd).toContain('permissions bypassed (--dangerously-skip-permissions)');
    expect(cmd.indexOf('permissions bypassed')).toBeLessThan(cmd.indexOf('exec zsh'));
  });
});
