export interface ChangedFile {
  path: string;
  status: "A" | "M" | "D" | "R";
  additions: number;
  deletions: number;
}

export type ChatEvent =
  | { type: "protocol"; version: string }
  | { type: "sync_start" }
  | { type: "sync_progress"; transferred: number; total: number }
  | { type: "sync_done"; filesChanged: number; durationMs: number }
  | { type: "chat_turn_start"; sessionId: string; turnIndex: number }
  | { type: "chat_text"; chunk: string }
  | { type: "chat_diff"; patch: string; files: ChangedFile[] }
  | { type: "chat_done"; tokensIn: number; tokensOut: number; durationMs: number }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "cancelled" };

const KNOWN = new Set([
  "protocol", "sync_start", "sync_progress", "sync_done",
  "chat_turn_start", "chat_text", "chat_diff", "chat_done", "error", "cancelled",
]);

export function parseChatLine(line: string): ChatEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let o: unknown;
  try {
    o = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const type = (o as Record<string, unknown>).type;
  if (typeof type !== "string" || !KNOWN.has(type)) return null;
  return o as ChatEvent;
}
