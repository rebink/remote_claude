import { describe, it, expect } from 'vitest';
import { gzipSync } from 'fflate';
import { nodeResolveMutagenDeps } from './node-deps.ts';

describe('nodeResolveMutagenDeps', () => {
  it('computes a correct sha256 and reports platform/arch/home', () => {
    const deps = nodeResolveMutagenDeps({ bundledPath: () => null });
    // sha256 of the empty string is well-known.
    expect(deps.sha256(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(deps.platform).toBe(process.platform);
    expect(deps.arch).toBe(process.arch);
    expect(typeof deps.homeDir).toBe('string');
  });

  it('which returns null for a command that does not exist', () => {
    const deps = nodeResolveMutagenDeps({ bundledPath: () => null });
    expect(deps.which('definitely-not-a-real-binary-xyz')).toBeNull();
  });
});

describe('nodeResolveMutagenDeps.extractArchive', () => {
  it('extracts a binary from a real gzipped tar end-to-end', () => {
    const enc = new TextEncoder();
    const content = enc.encode('REAL-BINARY');
    const header = new Uint8Array(512);
    header.set(enc.encode('mutagen'), 0);
    header.set(enc.encode(content.length.toString(8).padStart(11, '0')), 124);
    header[156] = '0'.charCodeAt(0);
    const bodyLen = Math.ceil(content.length / 512) * 512;
    const tar = new Uint8Array(512 + bodyLen + 1024);
    tar.set(header, 0);
    tar.set(content, 512);
    const targz = Buffer.from(gzipSync(tar));

    const deps = nodeResolveMutagenDeps({ bundledPath: () => null });
    const out = deps.extractArchive(targz, 'mutagen', 'tar.gz');
    expect(out.toString()).toBe('REAL-BINARY');
  });
});
