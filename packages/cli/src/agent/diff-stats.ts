export interface DiffStats {
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Count `+` / `-` body lines in a unified diff, excluding the `+++` / `---`
 * file-header lines. No tolerance for context-prefixed lines (e.g. ` +foo` —
 * leading whitespace means context line).
 */
export function countDiffLines(diff: string): DiffStats {
  if (!diff) return { linesAdded: 0, linesRemoved: 0 };
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) linesAdded++;
    else if (line.startsWith('-')) linesRemoved++;
  }
  return { linesAdded, linesRemoved };
}
