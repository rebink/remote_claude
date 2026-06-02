import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { JsonlAuditLog, NoopAuditLog, type AskAuditEntry } from '../../src/agent/audit-log.ts';

const TOKEN = 'tok-ana';

describe('policy enforcement on /ask', () => {
  let dir: string; let usersPath: string; let projectsRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-policy-enf-'));
    usersPath = join(dir, 'users.json');
    projectsRoot = join(dir, 'projects');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function store(): UsersStore {
    const s = new UsersStore(usersPath);
    s.addUser('ana', TOKEN);
    return s;
  }
  function server(usersStore: UsersStore, auditLog = new NoopAuditLog()) {
    return buildServer({
      usersStore, projectsRoot,
      aiCommand: 'true', aiArgs: [],
      timeoutSec: 5, version: 'test', auditLog,
    });
  }
  function ask(app: ReturnType<typeof buildServer>, project: string) {
    return app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: 'hi', project },
    });
  }

  it('403 project_not_allowed for a project off the allowlist', async () => {
    const s = store();
    s.setProjects('ana', ['allowed']);
    const res = await ask(server(s), 'secret');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'project_not_allowed' });
  });

  it('403 rate_limited when audited count is at the cap', async () => {
    const s = store();
    s.setRateLimit('ana', { max: 2, windowMs: 3600_000 });
    const auditPath = join(dir, 'agent.log');
    const audit = new JsonlAuditLog({ path: auditPath });
    const entry = (over: Partial<AskAuditEntry>): AskAuditEntry => ({
      route: '/ask', ts: new Date().toISOString(), user: 'ana', project: 'app',
      prompt_sha256: 'a'.repeat(64), files: 0, lines_added: 0, lines_removed: 0,
      duration_ms: 1, queue_wait_ms: 0, exit_code: 0, ...over,
    });
    audit.append(entry({}));
    audit.append(entry({}));
    const res = await ask(server(s, audit), 'app');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'rate_limited' });
  });

  it('policy allowed: request passes through to real preflight checks', async () => {
    const s = store();
    s.setProjects('ana', ['app']);
    const res = await ask(server(s), 'app');
    // Policy allowed it through; the project dir does not exist → NOT 403.
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(404);
  });
});

describe('policy enforcement on /chat', () => {
  let dir: string; let usersPath: string; let projectsRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-policy-chat-'));
    usersPath = join(dir, 'users.json');
    projectsRoot = join(dir, 'projects');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function store(): UsersStore {
    const s = new UsersStore(usersPath);
    s.addUser('ana', TOKEN);
    return s;
  }
  function server(usersStore: UsersStore, auditLog = new NoopAuditLog()) {
    return buildServer({
      usersStore, projectsRoot,
      aiCommand: 'true', aiArgs: [],
      timeoutSec: 5, version: 'test', auditLog,
    });
  }
  function chat(app: ReturnType<typeof buildServer>, projectName: string) {
    return app.inject({
      method: 'POST', url: '/chat',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        uuid: '00000000-0000-4000-8000-000000000001',
        prompt: 'hello',
        projectName,
      },
    });
  }

  it('403 project_not_allowed for a project off the allowlist', async () => {
    const s = store();
    s.setProjects('ana', ['allowed']);
    const res = await chat(server(s), 'secret');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'project_not_allowed' });
  });
});
