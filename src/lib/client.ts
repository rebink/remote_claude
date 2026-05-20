import { request, fetch } from 'undici';
import type { Config } from './config.ts';

/**
 * Low-level helper that POSTs/GETs JSON to the agent.
 * Used by commands like `init-remote` that don't fit the AgentClient class shape.
 */
export async function agentRequest<T = unknown>(
  cfg: Config,
  method: string,
  path: string,
  body?: unknown,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  let res;
  try {
    res = await fetch(`${cfg.remote.agentUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.remote.token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'TimeoutError') {
      throw new Error(`Agent ${method} ${path} timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`Agent ${method} ${path} failed: ${res.status} ${text}`);
  }
  return data as T;
}

/**
 * Streams an NDJSON response from a POST to the agent. Each line is parsed as JSON
 * and yielded individually. Handles split lines across chunks and yields any final
 * non-newline-terminated line.
 */
export async function* streamPostNdjson(
  cfg: Config,
  path: string,
  body: unknown,
): AsyncGenerator<unknown> {
  const res = await fetch(`${cfg.remote.agentUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.remote.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.body) throw new Error(`No response body from ${path}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) if (line) yield JSON.parse(line);
  }
  if (buf.trim()) yield JSON.parse(buf);
}

export interface AskRequest {
  prompt: string;
  project: string;
}

export interface AskResponse {
  diff: string;
  files: string[];
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  claude: { found: boolean; path?: string };
}

export class AgentClient {
  constructor(private cfg: Config) {}

  private headers(): Record<string, string> {
    return {
      'authorization': `Bearer ${this.cfg.remote.token}`,
      'content-type': 'application/json',
    };
  }

  async health(): Promise<HealthResponse> {
    const res = await request(`${this.cfg.remote.agentUrl}/health`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.statusCode !== 200) {
      throw new Error(`Agent /health returned ${res.statusCode}`);
    }
    return (await res.body.json()) as HealthResponse;
  }

  async ask(body: AskRequest): Promise<AskResponse> {
    const res = await request(`${this.cfg.remote.agentUrl}/ask`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      bodyTimeout: this.cfg.ai.timeoutSec * 1000,
      headersTimeout: this.cfg.ai.timeoutSec * 1000,
    });
    const text = await res.body.text();
    if (res.statusCode !== 200) {
      throw new Error(`Agent /ask returned ${res.statusCode}: ${text}`);
    }
    return JSON.parse(text) as AskResponse;
  }
}
