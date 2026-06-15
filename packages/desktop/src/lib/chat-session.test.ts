import { describe, it, expect } from "vitest";
import { initChatState, startTurn, applyChatEvent, parseApplyResult } from "./chat-session";

const uuid = "test-uuid-1234";

describe("chat session reducer", () => {
  it("initializes empty", () => {
    const s = initChatState(uuid);
    expect(s.sessionUuid).toBe(uuid);
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBe(false);
    expect(s.diff).toBeNull();
  });

  it("startTurn appends a user message and an empty assistant message and sets streaming", () => {
    const s = startTurn(initChatState(uuid), "add retry");
    expect(s.messages).toEqual([
      { role: "user", text: "add retry" },
      { role: "assistant", text: "" },
    ]);
    expect(s.streaming).toBe(true);
    expect(s.error).toBeNull();
    expect(s.diff).toBeNull();
  });

  it("chat_text appends chunks to the last assistant message", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "chat_text", chunk: "Hel" });
    s = applyChatEvent(s, { type: "chat_text", chunk: "lo" });
    expect(s.messages.at(-1)).toEqual({ role: "assistant", text: "Hello" });
  });

  it("chat_diff captures the reviewable diff", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "chat_diff", patch: "PATCH", files: [{ path: "a", status: "M", additions: 1, deletions: 0 }] });
    expect(s.diff).toEqual({ patch: "PATCH", files: [{ path: "a", status: "M", additions: 1, deletions: 0 }] });
  });

  it("chat_done ends streaming", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "chat_done", tokensIn: 10, tokensOut: 20, durationMs: 5 });
    expect(s.streaming).toBe(false);
  });

  it("sync_start sets syncing", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "sync_start" });
    expect(s.syncing).toBe(true);
  });

  it("sync_done clears syncing", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "sync_start" });
    s = applyChatEvent(s, { type: "sync_done", filesChanged: 3, durationMs: 100 });
    expect(s.syncing).toBe(false);
  });

  it("error sets error message and ends streaming", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "error", code: "E1", message: "boom", recoverable: false });
    expect(s.error).toBe("boom");
    expect(s.streaming).toBe(false);
  });

  it("cancelled ends streaming", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "cancelled" });
    expect(s.streaming).toBe(false);
  });

  it("reducer is pure — original state is not mutated", () => {
    const initial = initChatState(uuid);
    const after = startTurn(initial, "hello");
    expect(initial.messages).toEqual([]);
    expect(initial.streaming).toBe(false);
    expect(after).not.toBe(initial);
  });
});

describe("parseApplyResult", () => {
  it("parses a success result line", () => {
    expect(parseApplyResult('{"type":"result","applied":true,"files":["a","b"]}'))
      .toEqual({ applied: true, files: ["a", "b"] });
  });
  it("parses an error result line", () => {
    expect(parseApplyResult('{"type":"error","applied":false,"message":"nope"}'))
      .toEqual({ applied: false, files: [], error: "nope" });
  });
  it("returns applied:false on unparseable output", () => {
    expect(parseApplyResult("garbage")).toEqual({ applied: false, files: [], error: "unparseable apply output" });
  });
});
