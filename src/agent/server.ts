import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { verifyToken } from './auth.ts';
import { captureDiff, isClean, isGitRepo, resetClean } from './git.ts';
import { findClaude, runClaude } from './claude.ts';

export interface AgentOptions {
  token: string;
  projectsRoot: string;
  claudeCommand: string;
  claudeArgs: string[];
  timeoutSec: number;
  version: string;
}

const AskBody = z.object({
  prompt: z.string().min(1),
  project: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'invalid project name'),
});

export function buildServer(opts: AgentOptions) {
  const app = Fastify({ logger: { level: 'info' }, bodyLimit: 5 * 1024 * 1024 });

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

  return app;
}
