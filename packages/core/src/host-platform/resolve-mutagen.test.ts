import { describe, it, expect } from 'vitest';
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
