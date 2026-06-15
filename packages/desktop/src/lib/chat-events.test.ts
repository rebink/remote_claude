import { describe, it, expect } from "vitest";
import { parseChatLine } from "./chat-events";

describe("parseChatLine", () => {
  it("parses a chat_text event", () => {
    expect(parseChatLine('{"type":"chat_text","chunk":"hi"}')).toEqual({ type: "chat_text", chunk: "hi" });
  });
  it("parses a chat_diff event with files", () => {
    const line = '{"type":"chat_diff","patch":"diff --git a/x b/x","files":[{"path":"x","status":"M","additions":3,"deletions":1}]}';
    const ev = parseChatLine(line);
    expect(ev).toEqual({
      type: "chat_diff",
      patch: "diff --git a/x b/x",
      files: [{ path: "x", status: "M", additions: 3, deletions: 1 }],
    });
  });
  it("returns null for blank or non-JSON lines", () => {
    expect(parseChatLine("")).toBeNull();
    expect(parseChatLine("   ")).toBeNull();
    expect(parseChatLine("not json")).toBeNull();
  });
  it("returns null for JSON without a string type", () => {
    expect(parseChatLine('{"foo":1}')).toBeNull();
  });
  it("passes through known event shapes generically by type", () => {
    expect(parseChatLine('{"type":"sync_start"}')).toEqual({ type: "sync_start" });
    expect(parseChatLine('{"type":"chat_done","tokensIn":10,"tokensOut":20,"durationMs":5}'))
      .toEqual({ type: "chat_done", tokensIn: 10, tokensOut: 20, durationMs: 5 });
  });
});
