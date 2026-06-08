// packages/cli/src/lib/attachments.ts
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, lstatSync, readdirSync, rmSync,
} from 'node:fs';
import { basename, join } from 'node:path';

export const INBOX_DIR = '.patchwire-inbox';
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Create the inbox dir and ensure `.patchwire-inbox/` is gitignored. Idempotent. */
export function ensureInbox(projectDir: string): void {
  mkdirSync(join(projectDir, INBOX_DIR), { recursive: true });
  const giPath = join(projectDir, '.gitignore');
  const line = `${INBOX_DIR}/`;
  const existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
  if (!existing.split(/\r?\n/).some((l) => l.trim() === line)) {
    writeFileSync(giPath, (existing && !existing.endsWith('\n') ? existing + '\n' : existing) + line + '\n');
  }
}

/** Strip path separators / unsafe chars down to a safe basename. */
export function sanitizeName(name: string): string {
  const safe = basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!safe) throw new Error(`Cannot derive a safe filename from: ${name}`);
  return safe;
}

/** Copy `localPath` into the inbox (collision-safe). Returns the project-relative path. */
export function stageAttachment(localPath: string, projectDir: string): string {
  if (!existsSync(localPath)) throw new Error(`Attachment not found: ${localPath}`);
  const st = lstatSync(localPath);
  if (!st.isFile()) throw new Error(`Attachment must be a regular file: ${localPath}`);
  if (st.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment too large (> ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB): ${localPath}`);
  }
  ensureInbox(projectDir);
  const safe = sanitizeName(localPath);
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let name = safe;
  for (let n = 2; existsSync(join(projectDir, INBOX_DIR, name)); n++) name = `${stem}-${n}${ext}`;
  copyFileSync(localPath, join(projectDir, INBOX_DIR, name));
  return `${INBOX_DIR}/${name}`;
}

/** posix-join the remote project path with a staged relative path. */
export function remoteAttachmentPath(remoteProjectPath: string, relPath: string): string {
  return `${remoteProjectPath.replace(/\/+$/, '')}/${relPath}`;
}

/** Empty the inbox (keep the dir). */
export function pruneInbox(projectDir: string): void {
  const inbox = join(projectDir, INBOX_DIR);
  if (!existsSync(inbox)) return;
  for (const f of readdirSync(inbox)) rmSync(join(inbox, f), { recursive: true, force: true });
}
