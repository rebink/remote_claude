import { describe, it, expect } from 'vitest';
import { buildPushPlan } from '../src/commands/push.ts';

const cfg = {
  project: 'myapp',
  remote: { host: 'mini', user: 'admin', path: '~/workspace/myapp', agentUrl: 'http://mini:7878', token: 't', sshPort: 2222 },
  sync: { exclude: [], secretScan: 'off' as const },
  ai: { command: 'claude', args: ['--print'], timeoutSec: 600 },
};

describe('buildPushPlan', () => {
  it('returns the remote inbox path and the ssh + rsync argv for a staged file', () => {
    const absLocal = '/work/myapp/.patchwire-inbox/shot.png';
    const plan = buildPushPlan(cfg, absLocal, '.patchwire-inbox/shot.png', '/home/me/.patchwire/keys/mini-admin');
    expect(plan.remotePath).toBe('~/workspace/myapp/.patchwire-inbox/shot.png');
    expect(plan.sshArg).toContain('-i /home/me/.patchwire/keys/mini-admin');
    expect(plan.sshArg).toContain('-p 2222');
    expect(plan.mkdirTarget).toBe('~/workspace/myapp/.patchwire-inbox');
    // rsync argv carries the -e ssh arg, the absolute local file, and the remote inbox dir target
    expect(plan.rsyncArgs).toContain('-e');
    expect(plan.rsyncArgs).toContain(absLocal);
    expect(plan.rsyncArgs[plan.rsyncArgs.length - 1]).toBe('admin@mini:~/workspace/myapp/.patchwire-inbox/');
  });

  it('omits -p when sshPort is unset', () => {
    const c2 = { ...cfg, remote: { ...cfg.remote, sshPort: undefined } };
    const plan = buildPushPlan(c2, '/abs/a.txt', '.patchwire-inbox/a.txt', '/k');
    expect(plan.sshArg).not.toContain('-p ');
  });
});
