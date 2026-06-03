import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { ConcurrencyManager } from '../../src/agent/concurrency.ts';
import { NoopAuditLog } from '../../src/agent/audit-log.ts';
import type { AskEvent } from '@patchwire/protocol';

/** Pull the `queueWaitMs` from the streamed NDJSON `/ask` `accepted` event. */
function askQueueWaitMs(payload: string): number {
  const accepted = payload
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AskEvent)
    .find((e) => e.type === 'accepted');
  return accepted?.type === 'accepted' ? accepted.queueWaitMs : 0;
}

describe('concurrency end-to-end', () => {
  let dir: string;
  let app: ReturnType<typeof buildServer>;

  function git(args: string[], cwd: string): void {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  }
  function makeProject(parent: string, name: string): void {
    const p = join(parent, name);
    mkdirSync(p, { recursive: true });
    git(['init', '-q', '-b', 'main'], p);
    git(['config', 'user.email', 't@e'], p);
    git(['config', 'user.name', 't'], p);
    git(['config', 'commit.gpgsign', 'false'], p);
    writeFileSync(join(p, 'a.txt'), 'one\n');
    git(['add', '.'], p);
    git(['commit', '-q', '-m', 'init'], p);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-conc-e2e-'));
    const store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    makeProject(join(dir, 'alice'), 'app');
    makeProject(join(dir, 'bob'), 'app');
    app = buildServer({
      usersStore: store, projectsRoot: dir,
      aiCommand: 'sh',
      aiArgs: ['-c', 'sleep 0.3'], // each "claude" run takes ~300ms
      timeoutSec: 5, version: 'e2e',
      concurrency: new ConcurrencyManager({ globalCap: 1, perUserCap: 1 }),
      auditLog: new NoopAuditLog(),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('with globalCap=1, two concurrent /ask requests serialize and the second reports a queue wait', async () => {
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST', url: '/ask',
        headers: { authorization: 'Bearer alice-token', 'content-type': 'application/json' },
        payload: { prompt: 'p', project: 'app' },
      }),
      app.inject({
        method: 'POST', url: '/ask',
        headers: { authorization: 'Bearer bob-token', 'content-type': 'application/json' },
        payload: { prompt: 'p', project: 'app' },
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const aWait = askQueueWaitMs(a.payload);
    const bWait = askQueueWaitMs(b.payload);
    // One of them ran first (wait ≈ 0), the other waited at least the fake AI duration (≈ 300ms).
    const waits = [aWait, bWait].sort((x, y) => x - y);
    expect(waits[0]).toBeLessThan(150);
    expect(waits[1]).toBeGreaterThanOrEqual(200);
  });

  it('GET /queue reflects in-flight + queued', async () => {
    // Start one long-ish request, then peek at /queue while it's running.
    const pending = app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: 'Bearer alice-token', 'content-type': 'application/json' },
      payload: { prompt: 'p', project: 'app' },
    });
    // Poll /queue until alice holds the in-flight lease, rather than guessing a
    // fixed sleep (which races the handler's lease acquisition on slow systems).
    let body: { inFlight: string[]; globalCap: number } = { inFlight: [], globalCap: 0 };
    const deadline = Date.now() + 2000;
    do {
      const snap = await app.inject({
        method: 'GET', url: '/queue',
        headers: { authorization: 'Bearer bob-token' },
      });
      expect(snap.statusCode).toBe(200);
      body = snap.json() as { inFlight: string[]; globalCap: number };
      if (body.inFlight.includes('alice')) break;
      await new Promise((r) => setTimeout(r, 25));
    } while (Date.now() < deadline);
    expect(body.inFlight).toContain('alice');
    expect(body.globalCap).toBe(1);
    await pending;
  });
});
