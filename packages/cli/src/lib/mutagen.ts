/**
 * Mutagen pure helpers + types.
 * Ported verbatim from packages/extension/src/sync/MutagenController.ts.
 * No spawn / IO — pure functions only.
 */
import { createHash } from "node:crypto";

export type MutagenStatus =
  | { kind: "not_installed" }
  | { kind: "no_session" }
  | { kind: "connecting" }
  | { kind: "watching" }
  | { kind: "syncing"; transferring?: number }
  | { kind: "conflict"; files: string[] }
  | { kind: "paused" }
  | { kind: "error"; message: string };

export interface MutagenTarget {
  project: string;
  host: string;
  user: string;
  sshPort?: number;
  localPath: string;
  remotePath: string;
  ignore?: string[];
}

// Baseline ignores — ported verbatim from MutagenController.ts IGNORE_PATTERNS
const IGNORE_PATTERNS = [
  "node_modules",
  ".next",
  "dist",
  "build",
  ".dart_tool",
  "ios/Pods",
  ".DS_Store",
  ".patchwire",
  ".devbridge",
];

function mergeIgnores(base: string[], extra: string[]): string[] {
  return [...base, ...extra.filter((p) => !base.includes(p))];
}

/** Short, stable hash of the local (alpha) path — makes the session name worktree-unique. */
function shortPathHash(localPath: string): string {
  return createHash("sha1").update(localPath.replace(/\/+$/, "")).digest("hex").slice(0, 8);
}

/**
 * Worktree-unique session name. Includes a hash of the local path so two
 * worktrees of the same project+host resolve to DISTINCT sessions instead of
 * colliding on one name. Mutagen names must match `[a-z0-9](-?[a-z0-9])*` —
 * lowercase alphanumeric with single dashes. No underscores, dots, uppercase.
 *
 * MUST stay in sync with the `sessionName` getter in
 * packages/extension/src/sync/MutagenController.ts.
 */
export function sessionName(project: string, host: string, localPath: string): string {
  const raw = `rc-${project}-${host}-${shortPathHash(localPath)}`.toLowerCase();
  return raw.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Build the argument array for `mutagen sync create`.
 * Endpoints: alpha = localPath, beta = user@host:remotePath.
 */
export function buildCreateArgs(name: string, target: MutagenTarget): string[] {
  const beta = `${target.user}@${target.host}:${target.remotePath}`;
  return [
    "sync", "create",
    "--name", name,
    "--mode", "two-way-resolved",
    "--symlink-mode", "posix-raw",
    "--ignore-vcs",
    ...mergeIgnores(IGNORE_PATTERNS, target.ignore ?? []).flatMap((p) => ["--ignore", p]),
    "--default-file-mode", "0644",
    "--default-directory-mode", "0755",
    target.localPath,
    beta,
  ];
}

/**
 * Parse one line of output from:
 *   mutagen sync list --template "{{ range . }}{{ .Status }}|{{ .Paused }}|{{ len .Conflicts }}{{ end }}"
 */
export function parseStatusLine(out: string): MutagenStatus {
  const parts = out.trim().split("|");
  const statusWord = parts[0] ?? "";
  const paused = (parts[1] ?? "").toLowerCase() === "true";
  const conflictCount = Number(parts[2] ?? "0");
  if (paused) return { kind: "paused" };
  if (conflictCount > 0) return { kind: "conflict", files: [] };
  const s = statusWord.toLowerCase();
  if (s.includes("watching") || s.includes("ready") || s === "") return { kind: "watching" };
  if (s.includes("connect")) return { kind: "connecting" };
  // Anything else (scanning, staging, reconciling) → syncing
  return { kind: "syncing" };
}

/**
 * Pull conflicting file paths out of `mutagen sync list --long` output.
 * Best-effort — if mutagen's output format drifts, returns an empty list.
 */
export function extractConflictPaths(longOut: string): string[] {
  const lines = longOut.split("\n");
  const out: string[] = [];
  let inConflicts = false;
  for (const line of lines) {
    if (/^Conflicts:/i.test(line.trim())) { inConflicts = true; continue; }
    if (inConflicts) {
      if (!line.trim()) { inConflicts = false; continue; }
      const m = line.match(/(?:α|β)\s*\(([^)]+)\)/) || line.match(/^\s*[α|β]?\s*"?([^"\s][^"\n]+)"?\s*$/);
      if (m && m[1]) out.push(m[1]);
    }
  }
  return out;
}

export const MUTAGEN_STATUS_TEMPLATE =
  "{{ range . }}{{ .Status }}|{{ .Paused }}|{{ len .Conflicts }}{{ end }}";

// ---------------------------------------------------------------------------
// Runner-based session ops
// ---------------------------------------------------------------------------

export interface RunResult { status: number; stdout: string; stderr: string }
export type MutagenRunner = (args: string[]) => RunResult;

export function getStatus(run: MutagenRunner, name: string): MutagenStatus {
  try {
    const r = run(["sync", "list", name, "--template", MUTAGEN_STATUS_TEMPLATE]);
    if (r.status !== 0) return { kind: "no_session" };
    const status = parseStatusLine(r.stdout);
    if (status.kind === "conflict") {
      const long = run(["sync", "list", name, "--long"]);
      return { kind: "conflict", files: extractConflictPaths(long.stdout || "").slice(0, 10) };
    }
    return status;
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

export function ensureSession(run: MutagenRunner, target: MutagenTarget): void {
  const name = sessionName(target.project, target.host, target.localPath);
  const exists = run(["sync", "list", name, "--template", "{{ range . }}{{ .Name }}{{ end }}"]);
  if (exists.status === 0 && exists.stdout.trim() !== "") return; // already exists
  run(buildCreateArgs(name, target));
}

export function pauseSession(run: MutagenRunner, name: string): void { run(["sync", "pause", name]); }
export function resumeSession(run: MutagenRunner, name: string): void { run(["sync", "resume", name]); }
export function flushSession(run: MutagenRunner, name: string): void { run(["sync", "flush", name]); }
export function stopSession(run: MutagenRunner, name: string): void { run(["sync", "terminate", name]); }
