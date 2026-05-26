import { describe, it, expect } from 'vitest';
import {
  bootstrapSnapshot,
  parseRsyncVersion,
  type BootstrapDeps,
  type BootstrapEvent,
} from '../../src/lib/bootstrap-snapshot.ts';

function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  return (async () => {
    const out: T[] = [];
    for await (const e of events) out.push(e);
    return out;
  })();
}

function happyDeps(overrides: Partial<BootstrapDeps> = {}): BootstrapDeps {
  return {
    runSsh: async () => ({ code: 0, stdout: '', stderr: '' }),
    runRsync: async function* () {
      yield { type: 'progress', stage: 'rsync', files: 1, bytes: 100, pct: 100, current: 'a' };
      return { code: 0, stderr: '' };
    },
    existsKey: () => true,
    ...overrides,
  };
}

describe('bootstrapSnapshot', () => {
  it('emits probe → rsync → git_init → done on the happy path', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x' },
        happyDeps({
          runSsh: async (_, cmd) => {
            if (cmd.includes('test -d')) return { code: 1, stdout: '', stderr: '' }; // does not exist
            return { code: 0, stdout: '', stderr: '' };
          },
        }),
      ),
    );
    const names = events.filter((e) => e.type === 'step').map((e) => `${e.name}:${e.status}`);
    expect(names).toContain('probe:ok');
    expect(names).toContain('rsync:ok');
    expect(names).toContain('git_init:ok');
    expect(names).toContain('safety:ok');
    const done = events.find((e) => e.type === 'done') as Extract<BootstrapEvent, { type: 'done' }>;
    expect(done.ok).toBe(true);
  });

  it('aborts with target_exists when probe finds the dir and no override flag set', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x' },
        happyDeps({ runSsh: async (_, cmd) =>
          cmd.includes('test -d') ? { code: 0, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' }
        }),
      ),
    );
    const failed = events.find((e) => e.type === 'step' && e.status === 'fail');
    expect(failed).toMatchObject({ name: 'probe', code: 'target_exists' });
    const done = events.find((e) => e.type === 'done') as Extract<BootstrapEvent, { type: 'done' }>;
    expect(done.ok).toBe(false);
  });

  it('runs rm -rf first when --overwrite is set', async () => {
    const commandsSeen: string[] = [];
    await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x', overwrite: true },
        happyDeps({
          runSsh: async (_, cmd) => {
            commandsSeen.push(cmd);
            if (cmd.includes('test -d')) return { code: 0, stdout: '', stderr: '' }; // exists
            return { code: 0, stdout: '', stderr: '' };
          },
        }),
      ),
    );
    const wipeIdx = commandsSeen.findIndex((c) => c.startsWith('rm -rf'));
    const mkdirIdx = commandsSeen.findIndex((c) => c.startsWith('mkdir -p'));
    expect(wipeIdx).toBeGreaterThanOrEqual(0);
    expect(mkdirIdx).toBeGreaterThan(wipeIdx);
  });

  it('skips mkdir and rsync when --use-existing is set', async () => {
    let rsyncCalled = false;
    const commandsSeen: string[] = [];
    await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x', useExisting: true },
        happyDeps({
          runSsh: async (_, cmd) => {
            commandsSeen.push(cmd);
            if (cmd.includes('test -d')) return { code: 0, stdout: '', stderr: '' }; // exists
            return { code: 0, stdout: '', stderr: '' };
          },
          runRsync: async function* () { rsyncCalled = true; return { code: 0, stderr: '' }; },
        }),
      ),
    );
    expect(rsyncCalled).toBe(false);
    expect(commandsSeen.some((c) => c.startsWith('mkdir -p'))).toBe(false);
    expect(commandsSeen.some((c) => c.includes('git init -q'))).toBe(true);
    expect(commandsSeen.some((c) => c.includes('git remote -v'))).toBe(true);
  });

  it('fails with missing_key when key file is absent', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/missing', project: 'app', localPath: '/tmp/x' },
        happyDeps({ existsKey: () => false }),
      ),
    );
    const failed = events.find((e) => e.type === 'step' && e.status === 'fail');
    expect(failed).toMatchObject({ name: 'key', code: 'missing_key' });
  });

  it('fails with invalid_project_name when project contains unsafe characters', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: '../etc', localPath: '/tmp/x' },
        happyDeps(),
      ),
    );
    const failed = events.find((e) => e.type === 'step' && e.status === 'fail');
    expect(failed).toMatchObject({ name: 'validate', code: 'invalid_project_name' });
  });

  it('fails with invalid_project_name for ".."', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: '..', localPath: '/tmp/x' },
        happyDeps(),
      ),
    );
    const failed = events.find((e) => e.type === 'step' && e.status === 'fail');
    expect(failed).toMatchObject({ name: 'validate', code: 'invalid_project_name' });
  });

  it('fails with unsafe_state if git remote -v returns non-empty', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x' },
        happyDeps({
          runSsh: async (_, cmd) => {
            if (cmd.includes('test -d')) return { code: 1, stdout: '', stderr: '' };
            if (cmd.includes('git remote -v')) return { code: 0, stdout: 'origin\thttps://x\t(fetch)\n', stderr: '' };
            return { code: 0, stdout: '', stderr: '' };
          },
        }),
      ),
    );
    const failed = events.find((e) => e.type === 'step' && e.status === 'fail');
    expect(failed).toMatchObject({ name: 'safety', code: 'unsafe_state' });
  });
});

describe('parseRsyncVersion', () => {
  it('parses modern rsync 3.x.y output', () => {
    expect(parseRsyncVersion('rsync  version 3.2.7  protocol version 31\n'))
      .toEqual({ major: 3, minor: 2, patch: 7 });
  });

  it('parses Apple\'s ancient rsync 2.6.9 output', () => {
    expect(parseRsyncVersion('rsync  version 2.6.9  protocol version 29\n'))
      .toEqual({ major: 2, minor: 6, patch: 9 });
  });

  it('handles two-component versions (no patch)', () => {
    expect(parseRsyncVersion('rsync version 3.1\n'))
      .toEqual({ major: 3, minor: 1, patch: 0 });
  });

  it('returns null on unrecognized output', () => {
    expect(parseRsyncVersion('not rsync at all\n')).toBeNull();
    expect(parseRsyncVersion('')).toBeNull();
  });
});
