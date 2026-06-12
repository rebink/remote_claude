import { gunzipSync, unzipSync } from 'fflate';
import { basename } from 'node:path';

export type ArchiveFormat = 'tar.gz' | 'zip' | 'raw';

/** Infer the archive format from a download URL. */
export function archiveFormat(url: string): ArchiveFormat {
  const u = url.toLowerCase();
  if (u.endsWith('.tar.gz') || u.endsWith('.tgz')) return 'tar.gz';
  if (u.endsWith('.zip')) return 'zip';
  return 'raw';
}

/** Read a NUL-terminated string field from a tar header. */
function readField(b: Uint8Array, start: number, len: number): string {
  let end = start;
  const limit = start + len;
  while (end < limit && b[end] !== 0) end++;
  return Buffer.from(b.subarray(start, end)).toString('utf8');
}

/** Walk a (decompressed) tar into a name→bytes map. Ignores checksums; handles the simple
 *  regular-file entries Mutagen's release tarball uses. */
function readTar(tar: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readField(header, 0, 100);
    const size = parseInt(readField(header, 124, 12).trim() || '0', 8);
    off += 512;
    if (name) files.set(name, tar.subarray(off, off + size));
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

/**
 * Extract the binary at `archiveBinaryPath` from a downloaded archive's bytes.
 * Pure: no filesystem or network. Matches by exact name, falling back to basename.
 */
export function extractMutagenBinary(
  archiveBytes: Buffer,
  archiveBinaryPath: string,
  format: 'tar.gz' | 'zip',
): Buffer {
  if (!archiveBinaryPath) {
    throw new Error('archiveBinaryPath is required to extract a mutagen binary from an archive');
  }
  const bytes = new Uint8Array(archiveBytes);
  const files =
    format === 'tar.gz'
      ? readTar(gunzipSync(bytes))
      : new Map<string, Uint8Array>(Object.entries(unzipSync(bytes)));

  const exact = files.get(archiveBinaryPath);
  const found =
    exact ??
    [...files.entries()].find(([name]) => basename(name) === basename(archiveBinaryPath))?.[1];
  if (!found) {
    throw new Error(`binary "${archiveBinaryPath}" not found in mutagen archive`);
  }
  return Buffer.from(found);
}
