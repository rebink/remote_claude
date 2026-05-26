/**
 * Filter a unified diff so only the sections for the listed file paths
 * survive. Each file section starts with `diff --git a/<old> b/<new>` and
 * runs until the next `diff --git` header or EOF. A section is included
 * if either its old-path or new-path matches a wanted path (so renames
 * are matched by either side).
 *
 * Returns an empty string when nothing matches.
 */
export function filterPatchByPaths(patch: string, wantedPaths: string[]): string {
  const wanted = new Set(wantedPaths);
  if (wanted.size === 0) return '';

  const sections: string[] = [];
  let current = '';
  let currentInclude = false;

  const flush = (): void => {
    if (current && currentInclude) sections.push(current);
    current = '';
    currentInclude = false;
  };

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = line + '\n';
      // `diff --git a/path b/path` — extract both. Paths with spaces are
      // double-quoted by git; we strip the quotes if present.
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (m) {
        const oldPath = stripQuotes(m[1]);
        const newPath = stripQuotes(m[2]);
        currentInclude = wanted.has(oldPath) || wanted.has(newPath);
      }
    } else if (current) {
      current += line + '\n';
    }
  }
  flush();
  return sections.join('');
}

function stripQuotes(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) return p.slice(1, -1);
  return p;
}
