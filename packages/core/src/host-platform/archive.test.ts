import { describe, it, expect } from 'vitest';
import { archiveFormat } from './archive.ts';
import { extractMutagenBinary } from './archive.ts';
import { gzipSync, zipSync } from 'fflate';

describe('archiveFormat', () => {
  it('detects tar.gz / tgz', () => {
    expect(archiveFormat('https://x/mutagen_v1.tar.gz')).toBe('tar.gz');
    expect(archiveFormat('https://x/mutagen.tgz')).toBe('tar.gz');
  });
  it('detects zip (case-insensitive)', () => {
    expect(archiveFormat('https://x/mutagen.zip')).toBe('zip');
    expect(archiveFormat('https://x/MUTAGEN.ZIP')).toBe('zip');
  });
  it('treats anything else as raw', () => {
    expect(archiveFormat('https://x/mutagen-darwin-arm64')).toBe('raw');
  });
});

/** Build a minimal single-entry tar (no checksum field — our reader ignores it). */
function makeTar(name: string, content: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const header = new Uint8Array(512);
  header.set(enc.encode(name), 0);
  header.set(enc.encode(content.length.toString(8).padStart(11, '0')), 124);
  header[156] = '0'.charCodeAt(0);
  const bodyLen = Math.ceil(content.length / 512) * 512;
  const body = new Uint8Array(bodyLen);
  body.set(content, 0);
  const out = new Uint8Array(512 + bodyLen + 1024);
  out.set(header, 0);
  out.set(body, 512);
  return out;
}

describe('extractMutagenBinary — tar.gz', () => {
  it('extracts the named entry from a gzipped tar', () => {
    const payload = new TextEncoder().encode('HELLO-BINARY');
    const targz = gzipSync(makeTar('mutagen', payload));
    const out = extractMutagenBinary(Buffer.from(targz), 'mutagen', 'tar.gz');
    expect(out.toString()).toBe('HELLO-BINARY');
  });
});

describe('extractMutagenBinary — zip', () => {
  it('extracts the named entry from a zip', () => {
    const zip = zipSync({ 'mutagen.exe': new TextEncoder().encode('WIN-BINARY') });
    const out = extractMutagenBinary(Buffer.from(zip), 'mutagen.exe', 'zip');
    expect(out.toString()).toBe('WIN-BINARY');
  });
});

describe('extractMutagenBinary — errors', () => {
  it('throws when the entry is missing', () => {
    const zip = zipSync({ 'other': new TextEncoder().encode('x') });
    expect(() => extractMutagenBinary(Buffer.from(zip), 'mutagen.exe', 'zip')).toThrow(/not found/i);
  });
  it('throws when archiveBinaryPath is empty', () => {
    expect(() => extractMutagenBinary(Buffer.from(''), '', 'tar.gz')).toThrow(/archiveBinaryPath/i);
  });
});
