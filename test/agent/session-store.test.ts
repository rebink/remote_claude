import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/agent/session-store.ts';

describe('SessionStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rc-sess-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('mints a new claude-session-id on first lookup and persists it', async () => {
    const store = new SessionStore(join(dir, 'sessions.json'));
    const a = await store.getOrCreate('uuid-1');
    const b = await store.getOrCreate('uuid-1');
    expect(a).toBe(b);
    // new instance should see the same mapping
    const store2 = new SessionStore(join(dir, 'sessions.json'));
    expect(await store2.getOrCreate('uuid-1')).toBe(a);
  });

  it('delete() removes the mapping', async () => {
    const store = new SessionStore(join(dir, 'sessions.json'));
    const a = await store.getOrCreate('uuid-2');
    await store.delete('uuid-2');
    const b = await store.getOrCreate('uuid-2');
    expect(b).not.toBe(a);
  });
});
