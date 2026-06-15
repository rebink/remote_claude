import type { ChatEvent, ChangedFile } from "./chat-events";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface PendingDiff {
  patch: string;
  files: ChangedFile[];
}

export interface ChatState {
  sessionUuid: string;
  messages: ChatMessage[];
  streaming: boolean;
  syncing: boolean;
  diff: PendingDiff | null;
  error: string | null;
}

export interface ApplyResult {
  applied: boolean;
  files: string[];
  error?: string;
}

export function initChatState(sessionUuid: string): ChatState {
  return { sessionUuid, messages: [], streaming: false, syncing: false, diff: null, error: null };
}

export function startTurn(state: ChatState, prompt: string): ChatState {
  return {
    ...state,
    messages: [...state.messages, { role: "user", text: prompt }, { role: "assistant", text: "" }],
    streaming: true,
    syncing: false,
    diff: null,
    error: null,
  };
}

function appendToAssistant(messages: ChatMessage[], chunk: string): ChatMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last.role !== "assistant") return messages;
  const updated = { ...last, text: last.text + chunk };
  return [...messages.slice(0, -1), updated];
}

export function applyChatEvent(state: ChatState, ev: ChatEvent): ChatState {
  switch (ev.type) {
    case "sync_start":
      return { ...state, syncing: true };
    case "sync_done":
      return { ...state, syncing: false };
    case "chat_text":
      return { ...state, messages: appendToAssistant(state.messages, ev.chunk) };
    case "chat_diff":
      return { ...state, diff: { patch: ev.patch, files: ev.files } };
    case "chat_done":
      return { ...state, streaming: false, syncing: false };
    case "error":
      return { ...state, streaming: false, syncing: false, error: ev.message };
    case "cancelled":
      return { ...state, streaming: false, syncing: false };
    default:
      return state; // protocol, sync_progress, chat_turn_start: no UI state change
  }
}

export function parseApplyResult(line: string): ApplyResult {
  try {
    const o = JSON.parse(line.trim());
    if (o && o.type === "result" && o.applied === true) {
      return { applied: true, files: Array.isArray(o.files) ? o.files : [] };
    }
    if (o && o.type === "error") {
      return { applied: false, files: [], error: typeof o.message === "string" ? o.message : "apply failed" };
    }
    return { applied: false, files: [], error: "unparseable apply output" };
  } catch {
    return { applied: false, files: [], error: "unparseable apply output" };
  }
}
