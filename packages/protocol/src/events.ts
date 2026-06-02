export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  additions: number;
  deletions: number;
}

export type CliEvent =
  | { type: 'protocol'; version: string }
  | { type: 'sync_start' }
  | { type: 'sync_progress'; transferred: number; total: number }
  | { type: 'sync_done'; filesChanged: number; durationMs: number }
  | { type: 'chat_turn_start'; sessionId: string; turnIndex: number }
  | { type: 'chat_text'; chunk: string }
  | { type: 'chat_diff'; patch: string; files: ChangedFile[] }
  | { type: 'chat_done'; tokensIn: number; tokensOut: number; durationMs: number }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'cancelled' };

export const SUPPORTED_PROTOCOL = '1';

/** Request body for `POST /ask`. */
export interface AskRequest {
  prompt: string;
  project: string;
}

/**
 * Terminal success payload for `/ask`. Identical to the `result` event minus
 * its `type` tag. `files` are filenames (from `captureDiff`), not ChangedFile.
 */
export interface AskResponse {
  diff: string;
  files: string[];
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * NDJSON event stream emitted by `POST /ask` (one JSON object per `\n`-delimited line).
 * Lifecycle: (`queued`?) -> `accepted` -> (`result` | `error`). `queued` is emitted
 * at most once, only when the request waits on the global concurrency cap.
 */
export type AskEvent =
  | { type: 'queued'; position: number }
  | { type: 'accepted'; queueWaitMs: number }
  | { type: 'result'; diff: string; files: string[]; durationMs: number; stdout: string; stderr: string; exitCode: number }
  | { type: 'error'; code: string; message: string };
