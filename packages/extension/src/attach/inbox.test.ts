import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listInbox, removeAttachment, INBOX_DIR } from './inbox.ts';

let dir: string;
const inbox = () => join(dir, INBOX_DIR);

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-inbox-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('listInbox', () => {
  it('returns [] when the inbox does not exist', () => {
    expect(listInbox(dir)).toEqual([]);
  });

  it('lists regular files sorted by name, with sizes and rel paths', () => {
    mkdirSync(inbox(), { recursive: true });
    writeFileSync(join(inbox(), 'b.txt'), 'xx');
    writeFileSync(join(inbox(), 'a.png'), 'yyyy');
    mkdirSync(join(inbox(), 'sub'));
    expect(listInbox(dir)).toEqual([
      { name: 'a.png', relPath: `${INBOX_DIR}/a.png`, size: 4 },
      { name: 'b.txt', relPath: `${INBOX_DIR}/b.txt`, size: 2 },
    ]);
  });
});

describe('removeAttachment', () => {
  it('deletes a staged file by name', () => {
    mkdirSync(inbox(), { recursive: true });
    writeFileSync(join(inbox(), 'a.png'), 'y');
    removeAttachment(dir, 'a.png');
    expect(existsSync(join(inbox(), 'a.png'))).toBe(false);
  });

  it('is a no-op for a missing file', () => {
    mkdirSync(inbox(), { recursive: true });
    expect(() => removeAttachment(dir, 'gone.png')).not.toThrow();
  });

  it('is a no-op when the inbox directory does not exist', () => {
    expect(() => removeAttachment(dir, 'gone.png')).not.toThrow();
  });

  it('rejects path traversal and absolute paths', () => {
    const outside = join(dir, 'secret.txt');
    writeFileSync(outside, 'keep');
    expect(() => removeAttachment(dir, '../secret.txt')).toThrow();
    expect(() => removeAttachment(dir, 'a/b.txt')).toThrow();
    expect(() => removeAttachment(dir, outside)).toThrow();
    expect(() => removeAttachment(dir, '..')).toThrow();
    expect(existsSync(outside)).toBe(true);
  });
});
