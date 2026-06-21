// packages/cli/src/services/discoverers/dart.ts
import { parseVmServiceUri, isLoopbackHost } from '../../lib/flutter-vmservice.ts';
import type { DiscoveredService } from '../types.ts';

/** Parse captured `flutter run` output into Dart VM + dev-server services. */
export function parseDartOutput(text: string): DiscoveredService[] {
  const out: DiscoveredService[] = [];

  const vmMatch = text.match(/Dart VM Service[^]*?(https?:\/\/\S+)/);
  if (vmMatch?.[1]) {
    const parsed = parseVmServiceUri(vmMatch[1]);
    if (parsed.ok && isLoopbackHost(parsed.value.host)) {
      const port = parsed.value.port;
      out.push({
        id: `dart-vm:${port}`,
        label: `Dart VM Service :${port}`,
        kind: 'dart-vm',
        localPort: port,
        connectionHint: `http://127.0.0.1:${port}`,
        meta: { authPath: parsed.value.authPath },
      });
    }
  }

  const webMatch = text.match(/served at (https?:\/\/\S+)/);
  if (webMatch?.[1]) {
    try {
      const u = new URL(webMatch[1]);
      if (isLoopbackHost(u.hostname) && u.port) {
        const port = Number(u.port);
        out.push({
          id: `dart-server:${port}`,
          label: `Dart dev server :${port}`,
          kind: 'dart-server',
          localPort: port,
          connectionHint: `http://127.0.0.1:${port}`,
        });
      }
    } catch { /* ignore unparsable */ }
  }

  return out;
}
