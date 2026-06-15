/**
 * Mutagen pure helpers + types.
 * Ported verbatim from packages/extension/src/sync/MutagenController.ts.
 * No spawn / IO — pure functions only.
 */

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

/**
 * Stable session name. Mutagen names must match `[a-z0-9](-?[a-z0-9])*` —
 * lowercase alphanumeric with single dashes. No underscores, dots, uppercase.
 */
export function sessionName(project: string, host: string): string {
  const raw = `rc-${project}-${host}`.toLowerCase();
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
