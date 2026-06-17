import { describe, it, expect } from 'vitest';
import { buildMcpConfig } from '../../../src/agent/flutter/mcp-config.ts';

describe('buildMcpConfig', () => {
  it('builds an mcp config that launches the patchwire flutter-mcp subcommand with VM env', () => {
    const cfg = buildMcpConfig({ project: 'app', url: 'http://127.0.0.1:9123/tok=/', target: 'web' }, '/usr/local/bin/patchwire');
    expect(cfg).toEqual({
      mcpServers: {
        'patchwire-flutter': {
          command: '/usr/local/bin/patchwire',
          args: ['flutter-mcp'],
          env: { PW_FLUTTER_VM_URL: 'http://127.0.0.1:9123/tok=/', PW_FLUTTER_TARGET: 'web' },
        },
      },
    });
  });
});
