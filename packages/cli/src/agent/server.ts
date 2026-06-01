import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ChatBody } from '@patchwire/protocol';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { UsersStore } from './users-store.ts';
import { resolveUserFromHeader } from './auth.ts';
import {
  captureDiff,
  cleanResetToHead,
  diffHead,
  isClean,
  isGitRepo,
  resetClean,
} from './git.ts';
import { findAiBin, makeAiRunner, runAi } from './ai-runner.ts';
import { runChatTurn } from './chat.ts';
import { SessionStore } from './session-store.ts';
import { TurnState } from './turn-state.ts';

declare module 'fastify' {
  interface FastifyRequest {
    username?: string;
  }
}

export interface AgentOptions {
  usersStore: UsersStore;
  projectsRoot: string;
  aiCommand: string;
  aiArgs: string[];
  timeoutSec: number;
  version: string;
  /** Path to the persistent session-store JSON. Defaults to `~/.patchwire/agent-sessions.json`. */
  sessionStorePath?: string;
}

const AskBody = z.object({
  prompt: z.string().min(1),
  project: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'invalid project name'),
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

/**
 * Mount the `GET /session/:id/status` route on the given Fastify instance.
 *
 * Extracted as an exported registrar (mirroring `registerDeleteSession`) so
 * tests can mount the route on a fresh Fastify instance with a hand-built
 * `TurnState` and avoid spinning up the full agent stack.
 *
 * Returns the typed `TurnRecord` on hit, 404 `{ code: 'unknown_uuid' }` on
 * miss. The agent process holds `TurnState` in memory only, so after an agent
 * restart all previously in-flight turns become `unknown_uuid` — the
 * extension treats that as "previous turn lost; please retry" (M6 Task 34).
 */
export function registerSessionStatus(app: FastifyInstance, turns: TurnState): void {
  app.get(
    '/session/:id/status',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const record = turns.get(req.params.id);
      if (!record) return reply.status(404).send({ code: 'unknown_uuid' });
      return record;
    },
  );
}


export function buildServer(opts: AgentOptions) {
  const app = Fastify({ logger: { level: 'info' }, bodyLimit: 5 * 1024 * 1024 });

  // Single SessionStore per server instance — persists uuid → claudeSessionId mapping.
  const sessionStorePath =
    opts.sessionStorePath ?? join(homedir(), '.patchwire', 'agent-sessions.json');
  const sessionStore = new SessionStore(sessionStorePath);

  // Mount DELETE /session/:id via the exported registrar so the same route
  // definition is exercised by `test/agent/delete-session.test.ts`.
  registerDeleteSession(app, sessionStore);

  // In-memory record of chat turns, updated by the POST /chat handler and
  // queried by GET /session/:id/status. Constructed once per server instance.
  const turns = new TurnState();
  registerSessionStatus(app, turns);

  // Streaming runner configured from AgentOptions (not env). Honors `--aiCommand`
  // / `--aiArgs` exactly the same way the `/ask` path does via `runAi`.
  const aiRunner = makeAiRunner({ bin: opts.aiCommand, args: opts.aiArgs });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const result = resolveUserFromHeader(req.headers.authorization, opts.usersStore);
    if (!result) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (result.disabled) {
      reply.code(403).send({ error: 'user disabled' });
      return;
    }
    req.username = result.user;
    opts.usersStore.touchLastSeen(result.user);
  });

  app.get('/health', async () => {
    const claude = findAiBin(opts.aiCommand);
    return { ok: true, version: opts.version, claude };
  });

  app.get('/me', async (req) => {
    const name = req.username!;
    const summary = opts.usersStore.list().find((u) => u.user === name);
    // Admin lookups won't appear in `list()`; surface a minimal record.
    if (!summary) {
      return { user: name, disabled: false };
    }
    return summary;
  });

  app.post('/ask', async (req, reply) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body', issues: parsed.error.issues };
    }
    const { prompt, project } = parsed.data;
    const username = req.username!;
    const userRoot = resolve(opts.projectsRoot, username);
    const projectDir = resolve(userRoot, project);
    if (!projectDir.startsWith(userRoot + sep)) {
      reply.code(400);
      return { error: 'invalid project name' };
    }
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
      claudeResult = await runAi({
        command: opts.aiCommand,
        args: opts.aiArgs,
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

  app.post('/chat', async (req, reply) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, code: 'missing_fields', errors: parsed.error.format() });
    }
    const body = parsed.data;
    const username = req.username!;
    const userRoot = resolve(opts.projectsRoot, username);
    const cwd = resolve(userRoot, body.projectName);
    if (!cwd.startsWith(userRoot + sep)) {
      return reply.status(400).send({ ok: false, code: 'invalid_project_name' });
    }
    if (!existsSync(cwd)) {
      return reply.status(404).send({ ok: false, code: 'project_not_found', path: cwd });
    }

    reply.raw.setHeader('content-type', 'application/x-ndjson');
    reply.hijack();
    const emit = (e: unknown) => reply.raw.write(JSON.stringify(e) + '\n');

    // TODO (M3 Task 24): wire client-disconnect cancellation by listening on
    //   req.raw.on('close') and aborting the spawned claude child via AbortSignal.
    //   Requires plumbing an AbortSignal through aiRunner.run.
    turns.start(body.uuid);
    try {
      await runChatTurn({
        uuid: body.uuid,
        prompt: body.prompt,
        cwd,
        store: sessionStore,
        ai: aiRunner,
        git: { diffHead, cleanResetToHead },
        // Wrap emit to record completion in TurnState. The wrapper MUST forward
        // every event to the original `emit` — the side effect for `chat_done`
        // is purely additive so GET /session/:id/status can report final
        // token counts + duration.
        emit: (e) => {
          if (e.type === 'chat_done') {
            turns.complete(body.uuid, {
              tokensIn: e.tokensIn,
              tokensOut: e.tokensOut,
              durationMs: e.durationMs,
            });
          }
          emit(e);
        },
      });
    } catch (err) {
      // Record the error in TurnState BEFORE emitting it on the wire — that
      // way the status endpoint reflects the error even if the socket write
      // fails (e.g. client already disconnected).
      turns.error(body.uuid, (err as Error).message);
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
