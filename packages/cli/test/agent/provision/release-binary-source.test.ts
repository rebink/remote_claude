import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { releaseBinarySource, assetName, type FetchLike } from '../../../src/agent/provision/release-binary-source.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';

function res(body: { ok?: boolean; status?: number; bytes?: Buffer; json?: unknown }) {
  return {
    ok: body.ok ?? true,
    status: body.status ?? 200,
    async arrayBuffer() {
      const b = body.bytes ?? Buffer.alloc(0);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
    async json() { return body.json; },
  };
}

const DETECTED = (os: string, arch = 'x64') => ({ os, arch } as unknown as DetectedServerPlatform);

describe('assetName', () => {
  it('maps macos/arm64 to patchwire-agent-darwin-arm64', () => {
    expect(assetName('macos', 'arm64')).toBe('patchwire-agent-darwin-arm64');
  });

  it('maps linux/x64 to patchwire-agent-linux-x64', () => {
    expect(assetName('linux', 'x64')).toBe('patchwire-agent-linux-x64');
  });

  it('maps windows/x64 to patchwire-agent-windows-x64.exe', () => {
    expect(assetName('windows', 'x64')).toBe('patchwire-agent-windows-x64.exe');
  });
});

describe('releaseBinarySource', () => {
  it('happy path: returns bytes + sha256 + version and fetches correct URLs', async () => {
    const bytes = Buffer.from('AGENTBIN');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const manifest = {
      version: '9.9.9',
      binaries: {
        'linux-x64': { file: 'patchwire-agent-linux-x64', sha256: sha },
      },
    };

    const requested: string[] = [];
    const fakeFetch: FetchLike = async (url) => {
      requested.push(url);
      if (url.endsWith('/manifest.json')) return res({ json: manifest });
      if (url.endsWith('/patchwire-agent-linux-x64')) return res({ bytes });
      return res({ ok: false, status: 404 });
    };

    const source = releaseBinarySource({ version: '9.9.9', baseUrl: 'http://x/rel', fetch: fakeFetch });
    const artifact = await source(DETECTED('linux', 'x64'));

    expect(artifact.bytes).toEqual(bytes);
    expect(artifact.sha256).toBe(sha);
    expect(artifact.version).toBe('9.9.9');
    expect(requested).toEqual(['http://x/rel/manifest.json', 'http://x/rel/patchwire-agent-linux-x64']);
  });

  it('sha mismatch throws /mismatch/', async () => {
    const bytes = Buffer.from('AGENTBIN');
    const manifest = {
      version: '9.9.9',
      binaries: {
        'linux-x64': { file: 'patchwire-agent-linux-x64', sha256: 'deadbeef' },
      },
    };

    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith('/manifest.json')) return res({ json: manifest });
      return res({ bytes });
    };

    const source = releaseBinarySource({ version: '9.9.9', baseUrl: 'http://x/rel', fetch: fakeFetch });
    await expect(source(DETECTED('linux', 'x64'))).rejects.toThrow(/mismatch/);
  });

  it('manifest 404 throws with HTTP status in message', async () => {
    const fakeFetch: FetchLike = async () => res({ ok: false, status: 404 });
    const source = releaseBinarySource({ version: '9.9.9', baseUrl: 'http://x/rel', fetch: fakeFetch });
    await expect(source(DETECTED('linux', 'x64'))).rejects.toThrow(/manifest/);
    await expect(source(DETECTED('linux', 'x64'))).rejects.toThrow(/404/);
  });

  it('asset 404 throws with HTTP status in message', async () => {
    const manifest = {
      version: '9.9.9',
      binaries: {
        'linux-x64': { file: 'patchwire-agent-linux-x64', sha256: 'a'.repeat(64) },
      },
    };
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith('/manifest.json')) return res({ json: manifest });
      return res({ ok: false, status: 404 });
    };
    const source = releaseBinarySource({ version: '9.9.9', baseUrl: 'http://x/rel', fetch: fakeFetch });
    await expect(source(DETECTED('linux', 'x64'))).rejects.toThrow(/download/);
    await expect(source(DETECTED('linux', 'x64'))).rejects.toThrow(/404/);
  });

  it('unsupported os (solaris) throws /no standalone agent binary/', async () => {
    const fakeFetch: FetchLike = async () => res({ json: {} });
    const source = releaseBinarySource({ version: '9.9.9', baseUrl: 'http://x/rel', fetch: fakeFetch });
    await expect(source(DETECTED('solaris'))).rejects.toThrow(/no standalone agent binary/);
  });

  it('windows happy path: returns bytes + sha256 + version, asset URL ends with .exe', async () => {
    const bytes = Buffer.from('WINBIN');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const manifest = {
      version: '2.0.0',
      binaries: {
        'windows-x64': { file: 'patchwire-agent-windows-x64.exe', sha256: sha },
      },
    };

    const requested: string[] = [];
    const fakeFetch: FetchLike = async (url) => {
      requested.push(url);
      if (url.endsWith('/manifest.json')) return res({ json: manifest });
      if (url.endsWith('/patchwire-agent-windows-x64.exe')) return res({ bytes });
      return res({ ok: false, status: 404 });
    };

    const source = releaseBinarySource({ version: '2.0.0', baseUrl: 'http://x/rel', fetch: fakeFetch });
    const artifact = await source(DETECTED('windows', 'x64'));

    expect(artifact.bytes).toEqual(bytes);
    expect(artifact.sha256).toBe(sha);
    expect(artifact.version).toBe('2.0.0');
    expect(requested[1]).toMatch(/patchwire-agent-windows-x64\.exe$/);
  });
});
