// packages/cli/test/lib/flutter-vmservice.test.ts
import { describe, it, expect } from 'vitest';
import { parseVmServiceUri, wsUrlFor, capabilitiesFor, isLoopbackHost } from '../../src/lib/flutter-vmservice.ts';

describe('parseVmServiceUri', () => {
  it('parses a standard http VM service uri with auth token path', () => {
    const r = parseVmServiceUri('http://127.0.0.1:50123/abcDEF123=/');
    expect(r).toEqual({ ok: true, value: { host: '127.0.0.1', port: 50123, authPath: '/abcDEF123=/' } });
  });

  it('accepts a ws uri and strips a trailing ws segment', () => {
    const r = parseVmServiceUri('ws://127.0.0.1:8181/tok=/ws');
    expect(r).toEqual({ ok: true, value: { host: '127.0.0.1', port: 8181, authPath: '/tok=/' } });
  });

  it('accepts a uri with no auth token (root path)', () => {
    const r = parseVmServiceUri('http://127.0.0.1:8181/');
    expect(r).toEqual({ ok: true, value: { host: '127.0.0.1', port: 8181, authPath: '/' } });
  });

  it('rejects garbage', () => {
    expect(parseVmServiceUri('not a url').ok).toBe(false);
  });

  it('rejects a missing port', () => {
    expect(parseVmServiceUri('http://127.0.0.1/tok=/').ok).toBe(false);
  });
});

describe('wsUrlFor', () => {
  it('builds a ws url against a tunnel host/port preserving the auth path', () => {
    const uri = { host: '127.0.0.1', port: 50123, authPath: '/abcDEF123=/' };
    expect(wsUrlFor(uri, '127.0.0.1', 9123)).toBe('ws://127.0.0.1:9123/abcDEF123=/ws');
  });

  it('handles a root auth path without doubling slashes', () => {
    const uri = { host: '127.0.0.1', port: 8181, authPath: '/' };
    expect(wsUrlFor(uri, '127.0.0.1', 9000)).toBe('ws://127.0.0.1:9000/ws');
  });
});

describe('isLoopbackHost', () => {
  it('accepts loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
  });
  it('rejects non-loopback hosts (SSRF targets)', () => {
    expect(isLoopbackHost('evil.com')).toBe(false);
    expect(isLoopbackHost('169.254.169.254')).toBe(false);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('10.0.0.5')).toBe(false);
  });
});

describe('capabilitiesFor', () => {
  it('device gets full capabilities including screenshot', () => {
    expect(capabilitiesFor('device')).toEqual({ hotReload: true, screenshot: true, inspect: true, logs: true });
  });
  it('web is degraded: no screenshot', () => {
    expect(capabilitiesFor('web')).toEqual({ hotReload: true, screenshot: false, inspect: true, logs: true });
  });
  it('desktop has no screenshot', () => {
    expect(capabilitiesFor('desktop').screenshot).toBe(false);
  });
});
