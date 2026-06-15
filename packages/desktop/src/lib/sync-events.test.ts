import { describe, it, expect } from "vitest";
import { parseSyncLine, syncKindToProjectStatus } from "./sync-events";

describe("parseSyncLine", () => {
  it("parses a sync_status line", () => {
    expect(parseSyncLine('{"type":"sync_status","kind":"watching","conflicts":[]}'))
      .toEqual({ type: "status", status: { kind: "watching", conflicts: [] } });
  });
  it("parses a conflict status with files", () => {
    expect(parseSyncLine('{"type":"sync_status","kind":"conflict","conflicts":["a.ts"]}'))
      .toEqual({ type: "status", status: { kind: "conflict", conflicts: ["a.ts"] } });
  });
  it("parses a sync_action line", () => {
    expect(parseSyncLine('{"type":"sync_action","action":"pause","ok":true}'))
      .toEqual({ type: "action", action: "pause", ok: true });
  });
  it("returns null for blank / non-JSON / unknown type", () => {
    expect(parseSyncLine("")).toBeNull();
    expect(parseSyncLine("nope")).toBeNull();
    expect(parseSyncLine('{"type":"other"}')).toBeNull();
  });
  it("defaults conflicts to [] when absent", () => {
    expect(parseSyncLine('{"type":"sync_status","kind":"paused"}'))
      .toEqual({ type: "status", status: { kind: "paused", conflicts: [] } });
  });
});

describe("syncKindToProjectStatus", () => {
  it("maps kinds to ProjectStatus", () => {
    expect(syncKindToProjectStatus("watching")).toBe("in-sync");
    expect(syncKindToProjectStatus("syncing")).toBe("working");
    expect(syncKindToProjectStatus("connecting")).toBe("working");
    expect(syncKindToProjectStatus("paused")).toBe("paused");
    expect(syncKindToProjectStatus("conflict")).toBe("conflict");
    expect(syncKindToProjectStatus("error")).toBe("error");
    expect(syncKindToProjectStatus("not_installed")).toBe("unknown");
    expect(syncKindToProjectStatus("no_session")).toBe("unknown");
  });
});
