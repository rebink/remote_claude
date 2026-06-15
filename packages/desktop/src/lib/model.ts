import type { Project, ProjectConfig, ProjectStatus } from "./types";

function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export function parseProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  const out: Project[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const localPath = typeof o.localPath === "string" ? o.localPath : "";
    const remotePath = typeof o.remotePath === "string" ? o.remotePath : "";
    if (!id || !localPath || !remotePath) continue;
    out.push({
      id,
      name: typeof o.name === "string" && o.name ? o.name : id,
      branch: typeof o.branch === "string" && o.branch ? o.branch : "main",
      localPath,
      remotePath,
      host: typeof o.host === "string" ? o.host : "",
      user: typeof o.user === "string" ? o.user : "",
      lastStatus: isStatus(o.lastStatus) ? o.lastStatus : "unknown",
      syncPaused: o.syncPaused === true,
    });
  }
  return out;
}

function isStatus(v: unknown): v is ProjectStatus {
  return (
    v === "in-sync" ||
    v === "working" ||
    v === "paused" ||
    v === "error" ||
    v === "conflict" ||
    v === "unknown"
  );
}

export function buildProject(
  localPath: string,
  remotePath: string,
  name?: string,
  host = "",
  user = "",
): Project {
  return {
    id: crypto.randomUUID(),
    name: name && name.trim() ? name.trim() : basename(localPath),
    branch: "main",
    localPath,
    remotePath,
    host,
    user,
    lastStatus: "unknown",
    syncPaused: false,
  };
}

export function projectFromConfig(localPath: string, cfg: ProjectConfig): Project {
  return {
    id: crypto.randomUUID(),
    name: cfg.project,
    branch: "main",
    localPath,
    remotePath: cfg.remotePath,
    host: cfg.host,
    user: cfg.user,
    lastStatus: "unknown",
    syncPaused: false,
  };
}

export function projectStatusLabel(
  status: ProjectStatus,
): { text: string; kind: "ok" | "warn" | "error" | "muted" } {
  switch (status) {
    case "in-sync":
      return { text: "In sync", kind: "ok" };
    case "working":
      return { text: "Claude working…", kind: "warn" };
    case "paused":
      return { text: "Sync paused", kind: "muted" };
    case "error":
      return { text: "Error", kind: "error" };
    case "conflict":
      return { text: "Conflict", kind: "error" };
    default:
      return { text: "—", kind: "muted" };
  }
}
