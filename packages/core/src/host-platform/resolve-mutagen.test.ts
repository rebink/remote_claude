import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { resolveMutagen, mutagenBinName } from './resolve-mutagen.ts';
import type { ResolveMutagenDeps, MutagenManifest } from './types.ts';

const EMPTY_MANIFEST: MutagenManifest = {};

function baseDeps(over: Partial<ResolveMutagenDeps> = {}): ResolveMutagenDeps {
  return {
    platform: 'darwin',
    arch: 'arm64',
    homeDir: '/home/u',
    which: () => null,
    bundledPath: () => null,
    fileExists: () => false,
    download: async () => Buffer.from(''),
    sha256: () => '',
    writeExecutable: () => {},
    ...over,
  };
}

describe('mutagenBinName', () => {
  it('appends .exe on win32 only', () => {
    expect(mutagenBinName('win32')).toBe('mutagen.exe');
    expect(mutagenBinName('linux')).toBe('mutagen');
    expect(mutagenBinName('darwin')).toBe('mutagen');
  });
});

describe('resolveMutagen — PATH tier', () => {
  it('returns the PATH hit when mutagen is on PATH', async () => {
    const deps = baseDeps({ which: (c) => (c === 'mutagen' ? '/usr/local/bin/mutagen' : null) });
    await expect(resolveMutagen(deps, EMPTY_MANIFEST)).resolves.toBe('/usr/local/bin/mutagen');
  });
});

describe('resolveMutagen — bundled tier', () => {
  it('returns the bundled path when PATH misses but a bundle exists', async () => {
    const deps = baseDeps({ which: () => null, bundledPath: () => '/app/bin/mutagen' });
    await expect(resolveMutagen(deps, EMPTY_MANIFEST)).resolves.toBe('/app/bin/mutagen');
  });
});

describe('resolveMutagen — cached tier', () => {
  it('returns the cached binary in ~/.patchwire/bin when it already exists', async () => {
    const cached = join('/home/u', '.patchwire', 'bin', 'mutagen');
    const deps = baseDeps({
      which: () => null,
      bundledPath: () => null,
      fileExists: (p) => p === cached,
    });
    await expect(resolveMutagen(deps, EMPTY_MANIFEST)).resolves.toBe(cached);
  });
});

const ONE_ENTRY: MutagenManifest = {
  'darwin-arm64': { url: 'https://dl.example/mutagen-darwin-arm64', sha256: 'abc123' },
};

describe('resolveMutagen — download tier', () => {
  it('downloads, verifies sha256, writes to cache, and returns the cached path', async () => {
    const cached = join('/home/u', '.patchwire', 'bin', 'mutagen');
    const written: { path: string; bytes: string }[] = [];
    const deps = baseDeps({
      which: () => null,
      bundledPath: () => null,
      fileExists: () => false,
      download: async (url) => Buffer.from(`BIN:${url}`),
      sha256: () => 'abc123',
      writeExecutable: (p, b) => written.push({ path: p, bytes: b.toString() }),
    });
    await expect(resolveMutagen(deps, ONE_ENTRY)).resolves.toBe(cached);
    expect(written).toEqual([{ path: cached, bytes: 'BIN:https://dl.example/mutagen-darwin-arm64' }]);
  });

  it('rejects when the downloaded checksum does not match', async () => {
    const deps = baseDeps({
      which: () => null,
      bundledPath: () => null,
      fileExists: () => false,
      download: async () => Buffer.from('tampered'),
      sha256: () => 'deadbeef',
    });
    await expect(resolveMutagen(deps, ONE_ENTRY)).rejects.toThrow(/checksum/i);
  });

  it('rejects with an actionable message when no manifest entry matches the os-arch', async () => {
    const deps = baseDeps({ platform: 'linux', arch: 'arm64', which: () => null, bundledPath: () => null });
    await expect(resolveMutagen(deps, ONE_ENTRY)).rejects.toThrow(/no mutagen build for linux-arm64/i);
  });
});
