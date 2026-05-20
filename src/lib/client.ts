import { request, fetch } from 'undici';
import type { Config } from './config.ts';

/**
 * Low-level helper that POSTs/GETs JSON to the agent.
 * Used by commands like `init-remote` that don't fit the AgentClient class shape.
 */
export async function agentRequest(
  cfg: Config,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${cfg.remote.agentUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.remote.token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
  return data;
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
