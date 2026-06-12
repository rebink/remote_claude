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
    extractArchive: () => Buffer.from(''),
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

describe('resolveMutagen — archive entries are extracted', () => {
  it('downloads, verifies, extracts via deps.extractArchive, and writes the extracted binary', async () => {
    const cached = join('/home/u', '.patchwire', 'bin', 'mutagen');
    const ARCHIVE_ENTRY: MutagenManifest = {
      'darwin-arm64': { url: 'https://dl.example/mutagen.tar.gz', sha256: 'abc123', archiveBinaryPath: 'mutagen' },
    };
    const written: { path: string; bytes: string }[] = [];
    let extractArgs: { bytes: string; path: string; fmt: string } | undefined;
    const deps = baseDeps({
      which: () => null,
      bundledPath: () => null,
      fileExists: () => false,
      download: async () => Buffer.from('ARCHIVE-BYTES'),
      sha256: () => 'abc123',
      extractArchive: (bytes, path, fmt) => {
        extractArgs = { bytes: bytes.toString(), path, fmt };
        return Buffer.from('EXTRACTED-BINARY');
      },
      writeExecutable: (p, b) => written.push({ path: p, bytes: b.toString() }),
    });
    await expect(resolveMutagen(deps, ARCHIVE_ENTRY)).resolves.toBe(cached);
    expect(extractArgs).toEqual({ bytes: 'ARCHIVE-BYTES', path: 'mutagen', fmt: 'tar.gz' });
    expect(written).toEqual([{ path: cached, bytes: 'EXTRACTED-BINARY' }]);
  });
});

describe('resolveMutagen — unsupported OS (no os-arch key)', () => {
  it('rejects with an actionable message on a platform with no manifest key', async () => {
    const deps = baseDeps({ platform: 'freebsd' as NodeJS.Platform, arch: 'x64', which: () => null, bundledPath: () => null });
    await expect(resolveMutagen(deps, ONE_ENTRY)).rejects.toThrow(/no mutagen build for freebsd-x64/i);
  });
});
