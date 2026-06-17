import { describe, it, expect } from 'vitest';
import { FlutterSessionStore } from '../../../src/agent/flutter/session-store.ts';

describe('FlutterSessionStore', () => {
  it('stores and retrieves a session per (user, project)', () => {
    const s = new FlutterSessionStore();
    s.set('alice', { project: 'app', url: 'http://127.0.0.1:9123/t=/', target: 'device' });
    expect(s.get('alice', 'app')?.target).toBe('device');
    expect(s.get('alice', 'other')).toBeUndefined();
    expect(s.get('bob', 'app')).toBeUndefined();
  });
  it('clears a session', () => {
    const s = new FlutterSessionStore();
    s.set('alice', { project: 'app', url: 'http://x/', target: 'web' });
    s.clear('alice', 'app');
    expect(s.get('alice', 'app')).toBeUndefined();
  });
});
