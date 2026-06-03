import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { NoopAuditLog } from '../../src/agent/audit-log.ts';

const TOKEN = 'tok-h';
const PATHISH = /\/(bin|usr|opt|home|Users|var|tmp|private|projects)\//;

describe('health + error responses leak no server paths', () => {
  let dir: string; let projectsRoot: string; let usersPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-health-'));
    projectsRoot = join(dir, 'projects');
    usersPath = join(dir, 'users.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function server(aiCommand: string) {
    const s = new UsersStore(usersPath); s.addUser('ana', TOKEN);
    return buildServer({
      usersStore: s, projectsRoot, aiCommand, aiArgs: [],
      timeoutSec: 5, version: '9.9.9', auditLog: new NoopAuditLog(),
    });
  }

  it('/health reports found but never the binary path', async () => {
    // 'sh' resolves to a real path; the OLD /health leaked it.
    const res = await server('sh').inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; version: string; claude: { found: boolean; path?: string } };
    expect(body.ok).toBe(true);
    expect(body.version).toBe('9.9.9');
    expect(body.claude.found).toBe(true);
    expect('path' in body.claude).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(PATHISH);
  });

  it('/ask 404 does not leak the project directory path', async () => {
    const res = await server('sh').inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: 'hi', project: 'missing' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(PATHISH);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'project not found' });
  });
});
