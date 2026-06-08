// packages/cli/test/attachments.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INBOX_DIR, MAX_ATTACHMENT_BYTES,
  ensureInbox, sanitizeName, stageAttachment, remoteAttachmentPath, pruneInbox,
} from '../src/lib/attachments.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-attach-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ensureInbox', () => {
  it('creates the inbox dir and adds a single gitignore line, idempotently', () => {
    ensureInbox(dir);
    ensureInbox(dir); // twice → still one line
    expect(existsSync(join(dir, INBOX_DIR))).toBe(true);
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi.match(new RegExp(`^${INBOX_DIR}/`, 'gm'))?.length).toBe(1);
  });
});

describe('sanitizeName', () => {
  it('strips path separators and keeps a safe basename', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeName('a b/c?.png')).toBe('c_.png');
  });
});

describe('stageAttachment', () => {
  it('copies into the inbox and returns the project-relative path', () => {
    const src = join(dir, 'shot.png');
    writeFileSync(src, 'PNGDATA');
    const rel = stageAttachment(src, dir);
    expect(rel).toBe(`${INBOX_DIR}/shot.png`);
    expect(readFileSync(join(dir, rel), 'utf8')).toBe('PNGDATA');
  });

  it('suffixes on collision instead of overwriting', () => {
    const src = join(dir, 'shot.png');
    writeFileSync(src, 'A');
    stageAttachment(src, dir);
    writeFileSync(src, 'B');
    const rel2 = stageAttachment(src, dir);
    expect(rel2).toBe(`${INBOX_DIR}/shot-2.png`);
    expect(readFileSync(join(dir, `${INBOX_DIR}/shot.png`), 'utf8')).toBe('A');
  });

  it('rejects files over the size cap', () => {
    const src = join(dir, 'big.bin');
    writeFileSync(src, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
    expect(() => stageAttachment(src, dir)).toThrow(/too large/i);
  });

  it('throws a clear error when the source is missing', () => {
    expect(() => stageAttachment(join(dir, 'nope.txt'), dir)).toThrow(/not found|no such/i);
  });
});

describe('remoteAttachmentPath', () => {
  it('posix-joins the remote project path with the staged relative path', () => {
    expect(remoteAttachmentPath('~/workspace/myapp', `${INBOX_DIR}/shot.png`))
      .toBe(`~/workspace/myapp/${INBOX_DIR}/shot.png`);
    expect(remoteAttachmentPath('/srv/app/', `${INBOX_DIR}/a.txt`))
      .toBe(`/srv/app/${INBOX_DIR}/a.txt`);
  });
});

describe('pruneInbox', () => {
  it('removes all files in the inbox but keeps the dir', () => {
    const src = join(dir, 'x.txt'); writeFileSync(src, 'x');
    stageAttachment(src, dir);
    pruneInbox(dir);
    expect(existsSync(join(dir, INBOX_DIR))).toBe(true);
    expect(readdirSync(join(dir, INBOX_DIR))).toEqual([]);
  });
});
