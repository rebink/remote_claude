import { describe, it, expect } from 'vitest';
import { withMcpArgs } from '../src/agent/ai-runner.ts';

describe('withMcpArgs', () => {
  it('appends --mcp-config and --strict-mcp-config when a path is given', () => {
    expect(withMcpArgs(['--print'], '/tmp/mcp.json')).toEqual(
      ['--print', '--mcp-config', '/tmp/mcp.json', '--strict-mcp-config']);
  });
  it('returns the args unchanged when no path is given', () => {
    expect(withMcpArgs(['--print'], undefined)).toEqual(['--print']);
  });
});
