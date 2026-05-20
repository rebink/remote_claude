import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { verifyToken } from './auth.ts';
import {
  captureDiff,
  cleanResetToHead,
  diffHead,
  isClean,
  isGitRepo,
  resetClean,
} from './git.ts';
import { findClaude, makeClaudeRunner, runClaude } from './claude.ts';
import { runInit } from './init.ts';
import { runChatTurn } from './chat.ts';
import { SessionStore } from './session-store.ts';

export interface AgentOptions {
  token: string;
  projectsRoot: string;
  claudeCommand: string;
  claudeArgs: string[];
  timeoutSec: number;
  version: string;
  /** Path to the persistent session-store JSON. Defaults to `~/.remote-claude/agent-sessions.json`. */
  sessionStorePath?: string;
}

const AskBody = z.object({
  prompt: z.string().min(1),
  project: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'invalid project name'),
});

export const InitBody = z.object({
  gitUrl: z.string().min(1),
  branch: z.string().min(1).regex(/^[a-zA-Z0-9_][a-zA-Z0-9/_.-]*$/, 'invalid branch name').optional(),
  projectName: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'invalid project name'),
});

/**
 * Mount the `DELETE /session/:id` route on the given Fastify instance.
 *
 * Extracted as an exported registrar so tests can mount the route on a fresh
 * Fastify instance without spinning up the full agent stack. The handler is
 * idempotent: deleting a non-existent uuid still returns 204.
 *
 * No Zod validation on `:id` — `SessionStore.delete` only removes a map key
 * and never constructs a filesystem path from the id, so the param is safe to
 * pass through unsanitized.
 */
export function registerDeleteSession(app: FastifyInstance, store: SessionStore): void {
  app.delete('/session/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    await store.delete(req.params.id);
    reply.status(204).send();
  });
}

export const ChatBody = z.object({
  // Accept canonical UUID v1-5 or a generic hex-ish session id (>=32 hex chars + optional dashes).
  uuid: z
    .string()
    .uuid()
    .or(z.string().regex(/^[a-f0-9-]{32,}$/i, 'invalid uuid')),
  prompt: z.string().min(1),
  projectName: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'invalid project name'),
});

export function buildServer(opts: AgentOptions) {
  const app = Fastify({ logger: { level: 'info' }, bodyLimit: 5 * 1024 * 1024 });

  // Single SessionStore per server instance — persists uuid → claudeSessionId mapping.
  const sessionStorePath =
    opts.sessionStorePath ?? join(homedir(), '.remote-claude', 'agent-sessions.json');
  const sessionStore = new SessionStore(sessionStorePath);

  // Mount DELETE /session/:id via the exported registrar so the same route
  // definition is exercised by `test/agent/delete-session.test.ts`.
  registerDeleteSession(app, sessionStore);

  // Streaming runner configured from AgentOptions (not env). Honors `--claudeCommand`
  // / `--claudeArgs` exactly the same way the `/ask` path does via `runClaude`.
  const claudeRunner = makeClaudeRunner({ bin: opts.claudeCommand, args: opts.claudeArgs });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const ok = verifyToken(req.headers.authorization, opts.token);
    if (!ok) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => {
    const claude = findClaude(opts.claudeCommand);
    return { ok: true, version: opts.version, claude };
  });

  app.post('/ask', async (req, reply) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    const { prompt, project } = parsed.data;
    const projectDir = resolve(opts.projectsRoot, project);
    if (!existsSync(projectDir)) {
      reply.code(404);
      return { error: `project not found: ${projectDir}` };
    }
    if (!(await isGitRepo(projectDir))) {
      reply.code(412);
      return { error: 'project is not a git repository on agent host' };
    }
    const status = await isClean(projectDir);
    if (!status.clean) {
      reply.code(409);
      return { error: 'agent working tree is dirty before run', status: status.status };
    }

    const start = Date.now();
    let claudeResult;
    try {
      claudeResult = await runClaude({
        command: opts.claudeCommand,
        args: opts.claudeArgs,
        prompt,
        cwd: projectDir,
        timeoutMs: opts.timeoutSec * 1000,
      });
    } catch (err) {
      await resetClean(projectDir).catch(() => {});
      reply.code(500);
      return { error: (err as Error).message };
    }

    let diffData;
    try {
      diffData = await captureDiff(projectDir);
    } finally {
      await resetClean(projectDir).catch(() => {});
    }

    return {
      diff: diffData.diff,
      files: diffData.files,
      durationMs: Date.now() - start,
      stdout: claudeResult.stdout,
      stderr: claudeResult.stderr,
      exitCode: claudeResult.exitCode,
    };
  });

  app.post('/init', async (req, reply) => {
    const parsed = InitBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, code: 'missing_fields', errors: parsed.error.format() });
    }
    const body = parsed.data;
    const result = await runInit({
      projectsRoot: opts.projectsRoot,
      gitUrl: body.gitUrl,
      branch: body.branch ?? 'main',
      projectName: body.projectName,
    });
    if (!result.ok) return reply.status(409).send(result);
    return result;
  });

  app.post('/chat', async (req, reply) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, code: 'missing_fields', errors: parsed.error.format() });
    }
    const body = parsed.data;
    const cwd = resolve(opts.projectsRoot, body.projectName);
    if (!existsSync(cwd)) {
      return reply.status(404).send({ ok: false, code: 'project_not_found', path: cwd });
    }

    reply.raw.setHeader('content-type', 'application/x-ndjson');
    reply.hijack();
    const emit = (e: unknown) => reply.raw.write(JSON.stringify(e) + '\n');

    // TODO (M3 Task 24): wire client-disconnect cancellation by listening on
    //   req.raw.on('close') and aborting the spawned claude child via AbortSignal.
    //   Requires plumbing an AbortSignal through claudeRunner.run.
    try {
      await runChatTurn({
        uuid: body.uuid,
        prompt: body.prompt,
        cwd,
        store: sessionStore,
        claude: claudeRunner,
        git: { diffHead, cleanResetToHead },
        emit,
      });
    } catch (err) {
      try {
        emit({
          type: 'error',
          code: 'turn_failed',
          message: (err as Error).message,
          recoverable: true,
        });
      } catch {
        /* socket already destroyed — nothing more we can do */
      }
    } finally {
      try {
        reply.raw.end();
      } catch {
        /* same */
      }
    }
  });

  return app;
}
