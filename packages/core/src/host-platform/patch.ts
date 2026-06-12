/** Normalize a unified-diff patch's line endings to LF so it applies cleanly on any OS. */
export function normalizePatch(patch: string): string {
  return patch.replace(/\r\n/g, '\n');
}
