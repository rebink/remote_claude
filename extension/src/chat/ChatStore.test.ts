import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatStore } from './ChatStore.ts';

describe('ChatStore', () => {
  it('creates, lists, persists, and deletes chats', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-cs-'));
    const store = new ChatStore(dir);
    const id = store.createChat('Refactor login_bloc');
    store.appendTurn(id, { role: 'user', text: 'hello', timestamp: 0 });
    store.appendTurn(id, { role: 'assistant', text: 'hi', timestamp: 1, patch: null });

    expect(store.listChats().map((c) => c.title)).toEqual(['Refactor login_bloc']);
    expect(store.loadTranscript(id).length).toBe(2);

    const store2 = new ChatStore(dir);
    expect(store2.listChats()[0].id).toBe(id);

    store2.deleteChat(id);
    expect(store2.listChats()).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips malformed transcript lines on load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-cs-'));
    const store = new ChatStore(dir);
    const id = store.createChat('partial');
    store.appendTurn(id, { role: 'user', text: 'a', timestamp: 0 });
    // simulate a half-written final line
    appendFileSync(store.transcriptPath(id), '{"role":"assistant","te');
    const t = store.loadTranscript(id);
    expect(t).toHaveLength(1);
    expect(t[0].text).toBe('a');
    rmSync(dir, { recursive: true, force: true });
  });

  it('hasChat returns false after delete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-cs-'));
    const store = new ChatStore(dir);
    const id = store.createChat('temp');
    expect(store.hasChat(id)).toBe(true);
    store.deleteChat(id);
    expect(store.hasChat(id)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('setInFlight / loadInFlight round-trip across reload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-cs-'));
    const store = new ChatStore(dir);
    const a = store.createChat('a');
    const b = store.createChat('b');
    expect(store.loadInFlight()).toEqual([]);
    store.setInFlight(a, true);
    store.setInFlight(b, true);
    expect(new Set(store.loadInFlight())).toEqual(new Set([a, b]));
    // Reload from disk via a fresh instance
    const store2 = new ChatStore(dir);
    expect(new Set(store2.loadInFlight())).toEqual(new Set([a, b]));
    store2.setInFlight(a, false);
    expect(store2.loadInFlight()).toEqual([b]);
    rmSync(dir, { recursive: true, force: true });
  });
});
