import { describe, it, expect } from 'vitest';
import { runInitRemote, type InitRemoteOpts } from '../../src/commands/init-remote.ts';
import type { BootstrapDeps } from '../../src/lib/bootstrap-snapshot.ts';

function baseOpts(): InitRemoteOpts {
  return {
    fromLocal: true,
    project: 'demo',
    host: 'mini',
    user: 'admin',
    sshPort: 22,
    keyPath: '/tmp/test-key',
    localPath: '/tmp/local',
    json: false,
  };
}

function happyDeps(overrides: Partial<BootstrapDeps> = {}): BootstrapDeps {
  return {
    existsKey: () => true,
    runSsh: async () => ({ code: 0, stdout: '', stderr: '' }),
    runRsync: async function* () { return { code: 0, stderr: '' }; },
    ...overrides,
  };
}

describe('runInitRemote (--from-local)', () => {
  it('rejects an unsafe project name', async () => {
    const result = await runInitRemote({ ...baseOpts(), project: '../etc' }, happyDeps());
    expect(result).toMatchObject({ ok: false, code: 'invalid_project_name' });
  });

  it('rejects single-dot or dot-dot project names', async () => {
    const r1 = await runInitRemote({ ...baseOpts(), project: '.' }, happyDeps());
    const r2 = await runInitRemote({ ...baseOpts(), project: '..' }, happyDeps());
    expect(r1).toMatchObject({ ok: false, code: 'invalid_project_name' });
    expect(r2).toMatchObject({ ok: false, code: 'invalid_project_name' });
  });

  it('reports missing_key without making any SSH call', async () => {
    let sshCalled = false;
    const deps = happyDeps({
      existsKey: () => false,
      runSsh: async () => {
        sshCalled = true;
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const r = await runInitRemote(baseOpts(), deps);
    expect(r).toMatchObject({ ok: false, code: 'missing_key' });
    expect(sshCalled).toBe(false);
  });

  it('returns ok:true on the happy path', async () => {
    const deps = happyDeps({
      runSsh: async (_, cmd) =>
        cmd.includes('test -d') ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' },
    });
    const r = await runInitRemote(baseOpts(), deps);
    expect(r).toEqual({
      ok: true,
      projectName: 'demo',
      remotePath: '~/workspace/demo',
    });
  });

  it('returns target_exists when remote dir present without --overwrite or --use-existing', async () => {
    const deps = happyDeps({
      runSsh: async () => ({ code: 0, stdout: '', stderr: '' }), // probe finds it
    });
    const r = await runInitRemote(baseOpts(), deps);
    expect(r).toMatchObject({ ok: false, code: 'target_exists' });
  });

  it('returns unsafe_state when git remote -v is non-empty', async () => {
    const deps = happyDeps({
      runSsh: async (_, cmd) => {
        if (cmd.includes('test -d')) return { code: 1, stdout: '', stderr: '' };
        if (cmd.includes('git remote -v')) return { code: 0, stdout: 'origin\thttps://x\t(fetch)\n', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const r = await runInitRemote(baseOpts(), deps);
    expect(r).toMatchObject({ ok: false, code: 'unsafe_state' });
  });

  it('emits NDJSON events to stdout under --json', async () => {
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const deps = happyDeps({
        runSsh: async (_, cmd) =>
          cmd.includes('test -d') ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' },
      });
      await runInitRemote({ ...baseOpts(), json: true }, deps);
    } finally {
      process.stdout.write = origWrite;
    }
    const joined = lines.join('');
    const events = joined.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const names = events.filter((e: { type: string }) => e.type === 'step').map((e: { name: string }) => e.name);
    expect(names).toContain('probe');
    expect(names).toContain('rsync');
    expect(names).toContain('git_init');
    expect(names).toContain('safety');
    const done = events.find((e: { type: string }) => e.type === 'done');
    expect(done).toEqual({ type: 'done', ok: true, projectName: 'demo', remotePath: '~/workspace/demo' });
  });
});
