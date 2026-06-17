// packages/cli/src/lib/flutter-vmservice.ts

export type TargetKind = 'device' | 'web' | 'desktop';

export interface VmServiceUri {
  host: string;
  port: number;
  /** Auth-token path segment, always starts and ends with '/', e.g. '/abc123=/' or '/'. */
  authPath: string;
}

export type Parse<T> = { ok: true; value: T } | { ok: false; error: string };

/** True only for loopback hosts. Used to enforce the VM Service URL is the reverse-tunnelled local endpoint (SSRF guard). */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * Parse a Dart VM Service URI as printed by `flutter run`
 * ("A Dart VM Service ... is available at: http://127.0.0.1:PORT/<token>=/").
 * Accepts http(s)/ws(s); tolerates a trailing `/ws`. The token lives in the URL
 * PATH and must be preserved verbatim — it is the VM Service's only auth.
 */
export function parseVmServiceUri(raw: string): Parse<VmServiceUri> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'not a valid URL' };
  }
  if (!/^(https?|wss?):$/.test(u.protocol)) {
    return { ok: false, error: `unsupported protocol ${u.protocol}` };
  }
  if (!u.port) return { ok: false, error: 'missing port' };
  let path = u.pathname;
  if (path.endsWith('/ws')) path = path.slice(0, -2); // drop trailing 'ws', keep slash
  if (!path.startsWith('/')) path = '/' + path;
  if (!path.endsWith('/')) path = path + '/';
  return { ok: true, value: { host: u.hostname, port: Number(u.port), authPath: path } };
}

/** Build the WebSocket URL the MCP server uses against the tunnelled host/port. */
export function wsUrlFor(uri: VmServiceUri, host: string, port: number): string {
  const base = uri.authPath === '/' ? '' : uri.authPath.replace(/\/$/, '');
  return `ws://${host}:${port}${base}/ws`;
}

export interface Capabilities {
  hotReload: boolean;
  screenshot: boolean;
  inspect: boolean;
  logs: boolean;
}

/** Capability matrix per target. Screenshot is device-only (web/desktop lack `_flutter.screenshot`). */
export function capabilitiesFor(kind: TargetKind): Capabilities {
  return {
    hotReload: true,
    screenshot: kind === 'device',
    inspect: true,
    logs: true,
  };
}
