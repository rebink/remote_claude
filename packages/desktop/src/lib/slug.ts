// packages/desktop/src/lib/slug.ts

/**
 * Turn an arbitrary machine/computer name into a safe single path segment
 * matching the remote project-name grammar [A-Za-z0-9._-]. Whitespace runs
 * collapse to '-'; unsupported characters are dropped. Returns "" when nothing
 * usable remains (caller should then fall back to another value).
 */
export function slugifySegment(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}
