import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { FlutterSessionStore } from '../../src/agent/flutter/session-store.ts';
import { registerFlutterSessionRoutes } from '../../src/agent/server.ts';

function appWith(store: FlutterSessionStore) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as { username?: string }).username = 'alice'; });
  registerFlutterSessionRoutes(app, store);
  return app;
}

describe('flutter session routes', () => {
  it('attaches via POST and stores the session', async () => {
    const store = new FlutterSessionStore();
    const app = appWith(store);
    const res = await app.inject({ method: 'POST', url: '/flutter/session',
      payload: { project: 'app', url: 'http://127.0.0.1:9123/t=/', target: 'device' } });
    expect(res.statusCode).toBe(204);
    expect(store.get('alice', 'app')?.target).toBe('device');
  });
  it('rejects an invalid target', async () => {
    const app = appWith(new FlutterSessionStore());
    const res = await app.inject({ method: 'POST', url: '/flutter/session',
      payload: { project: 'app', url: 'http://x/', target: 'phone' } });
    expect(res.statusCode).toBe(400);
  });
  it('detaches via DELETE', async () => {
    const store = new FlutterSessionStore();
    store.set('alice', { project: 'app', url: 'http://x/', target: 'web' });
    const app = appWith(store);
    const res = await app.inject({ method: 'DELETE', url: '/flutter/session/app' });
    expect(res.statusCode).toBe(204);
    expect(store.get('alice', 'app')).toBeUndefined();
  });
});
