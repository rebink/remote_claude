import { request } from 'undici';
import type { Config } from './config.ts';

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
