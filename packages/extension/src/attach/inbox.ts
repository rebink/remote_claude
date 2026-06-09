import { existsSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

// Wire contract: must match INBOX_DIR in packages/cli/src/lib/attachments.ts.
export const INBOX_DIR = '.patchwire-inbox';

export interface InboxEntry {
  name: string;     // basename, e.g. "mockup.png"
  relPath: string;  // ".patchwire-inbox/mockup.png"
  size: number;     // bytes
}

/**
 * List staged attachments, sorted by name. Empty if the inbox does not exist.
 * Regular files only: symlinks are intentionally skipped (`lstat`, not `stat`) so
 * a staged link can't point the "view" action at something outside the inbox.
 * `relPath` is always posix-joined ("/") to match the CLI's stageAttachment contract.
 */
export function listInbox(projectDir: string): InboxEntry[] {
  const inbox = join(projectDir, INBOX_DIR);
  if (!existsSync(inbox)) return [];
  const out: InboxEntry[] = [];
  for (const name of readdirSync(inbox)) {
    const st = lstatSync(join(inbox, name));
    if (!st.isFile()) continue;
    out.push({ name, relPath: `${INBOX_DIR}/${name}`, size: st.size });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete one staged attachment by name. The name must already be a bare basename
 * (no separators, not "." / ".."), which guarantees the target stays inside the
 * inbox. No-op if the file is absent. Throws on anything path-like.
 */
export function removeAttachment(projectDir: string, name: string): void {
  if (!name || name === '.' || name === '..' || name !== basename(name)) {
    throw new Error(`Invalid attachment name: ${name}`);
  }
  rmSync(join(projectDir, INBOX_DIR, name), { force: true });
}
