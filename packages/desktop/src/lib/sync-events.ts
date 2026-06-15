import type { ProjectStatus } from "./types";

export type SyncKind =
  | "not_installed"
  | "no_session"
  | "connecting"
  | "watching"
  | "syncing"
  | "conflict"
  | "paused"
  | "error";

export interface SyncStatus {
  kind: SyncKind;
  conflicts: string[];
}

export type SyncLine =
  | { type: "status"; status: SyncStatus }
  | { type: "action"; action: string; ok: boolean };

const KINDS = new Set<SyncKind>([
  "not_installed",
  "no_session",
  "connecting",
  "watching",
  "syncing",
  "conflict",
  "paused",
  "error",
]);

export function parseSyncLine(line: string): SyncLine | null {
  const t = line.trim();
  if (!t) return null;
  let o: unknown;
  try {
    o = JSON.parse(t);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const obj = o as Record<string, unknown>;
  if (
    obj["type"] === "sync_status" &&
    typeof obj["kind"] === "string" &&
    KINDS.has(obj["kind"] as SyncKind)
  ) {
    return {
      type: "status",
      status: {
        kind: obj["kind"] as SyncKind,
        conflicts: Array.isArray(obj["conflicts"]) ? (obj["conflicts"] as string[]) : [],
      },
    };
  }
  if (obj["type"] === "sync_action" && typeof obj["action"] === "string") {
    return { type: "action", action: obj["action"], ok: obj["ok"] === true };
  }
  return null;
}

export function syncKindToProjectStatus(kind: SyncKind): ProjectStatus {
  switch (kind) {
    case "watching":
      return "in-sync";
    case "syncing":
    case "connecting":
      return "working";
    case "paused":
      return "paused";
    case "conflict":
      return "conflict";
    case "error":
      return "error";
    default:
      return "unknown"; // not_installed, no_session
  }
}
