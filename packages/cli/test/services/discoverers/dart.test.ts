// packages/cli/test/services/discoverers/dart.test.ts
import { describe, it, expect } from 'vitest';
import { parseDartOutput } from '../../../src/services/discoverers/dart.ts';

const VM = 'A Dart VM Service on macOS is available at: http://127.0.0.1:50123/abc123=/';
const WEB = 'lib/main.dart is being served at http://127.0.0.1:8080';

describe('parseDartOutput', () => {
  it('extracts the Dart VM Service port as a dart-vm service', () => {
    const out = parseDartOutput(VM);
    const vm = out.find((s) => s.kind === 'dart-vm')!;
    expect(vm.localPort).toBe(50123);
    expect(vm.connectionHint).toBe('http://127.0.0.1:50123');
    expect(vm.id).toBe('dart-vm:50123');
  });

  it('extracts a dev-server port as a dart-server service', () => {
    const out = parseDartOutput([VM, WEB].join('\n'));
    const web = out.find((s) => s.kind === 'dart-server')!;
    expect(web.localPort).toBe(8080);
    expect(web.connectionHint).toBe('http://127.0.0.1:8080');
  });

  it('ignores non-loopback hosts (SSRF guard) and returns [] for noise', () => {
    expect(parseDartOutput('A Dart VM Service is available at: http://10.0.0.5:50123/t=/')).toEqual([]);
    expect(parseDartOutput('nothing here')).toEqual([]);
  });
});
