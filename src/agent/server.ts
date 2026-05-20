import Fastify from 'fastify';
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
import { claudeRunner, findClaude, runClaude } from './claude.ts';
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
      emit({
        type: 'error',
        code: 'turn_failed',
        message: (err as Error).message,
        recoverable: true,
      });
    }
    reply.raw.end();
  });

  return app;
}
