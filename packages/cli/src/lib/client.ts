import { request, fetch } from 'undici';
import type { Config } from './config.ts';
import type { AskEvent, AskRequest, AskResponse } from '@patchwire/protocol';

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
  options: { timeoutMs?: number } = {},
): AsyncGenerator<unknown> {
  const timeoutMs = options.timeoutMs ?? 1_800_000;
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${cfg.remote.agentUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.remote.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'TimeoutError') {
      throw new Error(`Agent POST ${path} timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
  if (!res.ok) {
    let bodyText = '';
    try { bodyText = await res.text(); } catch { /* ignore */ }
    throw new Error(`Agent POST ${path} failed: ${res.status} ${bodyText.slice(0, 500)}`);
  }
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

/**
 * Parse an NDJSON `/ask` event stream. Forwards every event to `onEvent` and
 * resolves to the `AskResponse` carried by the terminal `result` event. Throws
 * on an `error` event (carrying its message) or if the stream ends with no
 * terminal event.
 */
export async function parseAskStream(
  source: AsyncIterable<Uint8Array>,
  onEvent: (e: AskEvent) => void,
): Promise<AskResponse> {
  const decoder = new TextDecoder();
  let buf = '';
  let result: AskResponse | undefined;

  const handle = (line: string) => {
    if (!line.trim()) return;
    const e = JSON.parse(line) as AskEvent;
    onEvent(e);
    if (e.type === 'result') {
      // Explicit copy (not `{ type, ...rest }`) to avoid an unused `type` binding
      // under noUnusedLocals.
      result = {
        diff: e.diff,
        files: e.files,
        durationMs: e.durationMs,
        stdout: e.stdout,
        stderr: e.stderr,
        exitCode: e.exitCode,
      };
    } else if (e.type === 'error') {
      throw new Error(e.message);
    }
  };

  for await (const chunk of source) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) handle(line);
  }
  if (buf.trim()) handle(buf);

  if (!result) throw new Error('agent stream ended without result');
  return result;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  claude: { found: boolean; path?: string };
}

export interface WhoamiResponse {
  user: string;
  createdAt?: string;
  disabled: boolean;
  lastSeen?: string;
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

  async whoami(): Promise<WhoamiResponse> {
    const res = await request(`${this.cfg.remote.agentUrl}/me`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.statusCode !== 200) {
      const text = await res.body.text();
      throw new Error(`Agent /me returned ${res.statusCode}: ${text}`);
    }
    return (await res.body.json()) as WhoamiResponse;
  }

  async ask(body: AskRequest, onEvent?: (e: AskEvent) => void): Promise<AskResponse> {
    const res = await request(`${this.cfg.remote.agentUrl}/ask`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      bodyTimeout: this.cfg.ai.timeoutSec * 1000,
      headersTimeout: this.cfg.ai.timeoutSec * 1000,
    });
    if (res.statusCode !== 200) {
      const text = await res.body.text();
      throw new Error(`Agent /ask returned ${res.statusCode}: ${text}`);
    }
    return parseAskStream(res.body, onEvent ?? (() => {}));
  }
}
