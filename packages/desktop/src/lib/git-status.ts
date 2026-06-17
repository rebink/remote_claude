export interface ChangedEntry {
  status: string;
  path: string;
}

/** Parse `git status --porcelain` output into entries. Trims the 2-char XY code;
 *  for renames (`R  old -> new`) keeps the new path. */
export function parseGitStatus(stdout: string): ChangedEntry[] {
  const out: ChangedEntry[] = [];
  for (const raw of stdout.split("\n")) {
    if (!raw.trim()) continue;
    const code = raw.slice(0, 2).trim();
    let rest = raw.slice(3);
    const arrow = rest.indexOf(" -> ");
    if (arrow !== -1) rest = rest.slice(arrow + 4);
    out.push({ status: code, path: rest.trim() });
  }
  return out;
}
