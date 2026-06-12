# S0 — Mutagen Archive Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `resolveMutagen()`'s download tier produce a usable binary by extracting it from the real Mutagen release archives (`.tar.gz` on macOS/Linux, `.zip` on Windows), replacing the temporary "fail loud" guard.

**Architecture:** Extraction is a pure bytes→bytes transform implemented with `fflate` (tiny pure-JS gzip + zip) plus a minimal tar walker, living in a new `archive.ts`. It is wired into the existing dependency-injection seam as a new `extractArchive` dep, so `resolveMutagen`'s orchestration tests stay fast (mock the extractor) while the real extractor is tested directly against in-test-built archives. Chosen over shelling out to system `tar`/`unzip` (not uniformly present, not unit-testable) and over the streaming `tar` npm package (heavier; we only need one entry).

**Tech Stack:** TypeScript, vitest, `fflate` (new runtime dep), Node `node:path`. Builds on the resolver slice already merged into the branch.

**Spec:** `docs/specs/2026-06-12-core-spec.md` (Pillar 4); plan predecessor: `docs/superpowers/plans/2026-06-12-s0-mutagen-resolver.md`.

**Branch:** continue on `feat/s0-cross-platform-client` (or a fresh branch off it).

---

## Current state (already implemented)

`packages/core/src/host-platform/resolve-mutagen.ts` download tier currently does:
```ts
  if (entry.archiveBinaryPath) {
    throw new Error(`mutagen archive extraction not yet implemented for ${key}; ...`);
  }
  const bytes = await deps.download(entry.url);
  const got = deps.sha256(bytes);
  if (got !== entry.sha256) { throw new Error(`mutagen checksum mismatch: ...`); }
  deps.writeExecutable(cached, bytes);
  return cached;
```
This plan removes the guard and extracts after checksum verification.

## File structure

- Create: `packages/core/src/host-platform/archive.ts` — `archiveFormat()`, `extractMutagenBinary()`, internal `readTar()`.
- Create: `packages/core/src/host-platform/archive.test.ts` — pure extractor tests.
- Modify: `packages/core/src/host-platform/types.ts` — add `extractArchive` to `ResolveMutagenDeps`.
- Modify: `packages/core/src/host-platform/resolve-mutagen.ts` — replace guard with extraction.
- Modify: `packages/core/src/host-platform/resolve-mutagen.test.ts` — replace guard test; add `extractArchive` to fixture.
- Modify: `packages/core/src/host-platform/node-deps.ts` — wire real `extractArchive`.
- Modify: `packages/core/src/host-platform/node-deps.test.ts` — end-to-end extraction test.
- Modify: `packages/core/src/index.ts` — export `archiveFormat`, `extractMutagenBinary`.
- Modify: `packages/core/package.json` — add `fflate` dependency.

---

### Task 1: Add fflate dependency + `archive.ts` with format detection (TDD)

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/host-platform/archive.ts`
- Test: `packages/core/src/host-platform/archive.test.ts`

- [ ] **Step 1: Add `fflate` to `packages/core/package.json`**

Add a `dependencies` block (the file currently has only `devDependencies`). Place it before `devDependencies`:

```json
  "dependencies": {
    "fflate": "^0.8.2"
  },
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: completes; `fflate` linked into `@patchwire/core`. If it fails due to sandbox/network, STOP and report BLOCKED with the exact error.

- [ ] **Step 3: Write the failing test `packages/core/src/host-platform/archive.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { archiveFormat } from './archive.ts';

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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @patchwire/core test -- archive`
Expected: FAIL — cannot find `./archive.ts`.

- [ ] **Step 5: Create `packages/core/src/host-platform/archive.ts` with format detection only**

```ts
export type ArchiveFormat = 'tar.gz' | 'zip' | 'raw';

/** Infer the archive format from a download URL. */
export function archiveFormat(url: string): ArchiveFormat {
  const u = url.toLowerCase();
  if (u.endsWith('.tar.gz') || u.endsWith('.tgz')) return 'tar.gz';
  if (u.endsWith('.zip')) return 'zip';
  return 'raw';
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @patchwire/core test -- archive`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json packages/core/src/host-platform/archive.ts packages/core/src/host-platform/archive.test.ts pnpm-lock.yaml
git commit -m "feat(core): add fflate + archiveFormat detection"
```

---

### Task 2: Implement `extractMutagenBinary` (tar.gz + zip) (TDD)

**Files:**
- Modify: `packages/core/src/host-platform/archive.ts`
- Test: `packages/core/src/host-platform/archive.test.ts`

- [ ] **Step 1: Add failing tests (append to `archive.test.ts`; add `extractMutagenBinary` to the import and add the `fflate`/util imports)**

```ts
import { extractMutagenBinary } from './archive.ts';
import { gzipSync, zipSync } from 'fflate';

/** Build a minimal single-entry tar (no checksum field — our reader ignores it). */
function makeTar(name: string, content: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const header = new Uint8Array(512);
  header.set(enc.encode(name), 0);                                  // name (offset 0)
  header.set(enc.encode(content.length.toString(8).padStart(11, '0')), 124); // size octal (offset 124)
  header[156] = '0'.charCodeAt(0);                                  // typeflag '0' = regular file
  const bodyLen = Math.ceil(content.length / 512) * 512;
  const body = new Uint8Array(bodyLen);
  body.set(content, 0);
  const out = new Uint8Array(512 + bodyLen + 1024);                 // + two zero blocks = end
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
```

- [ ] **Step 2: Run test to verify the new ones fail**

Run: `pnpm --filter @patchwire/core test -- archive`
Expected: FAIL — `extractMutagenBinary` is not exported.

- [ ] **Step 3: Implement extraction in `archive.ts` (append below `archiveFormat`)**

```ts
import { gunzipSync, unzipSync } from 'fflate';
import { basename } from 'node:path';

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
    if (header.every((byte) => byte === 0)) break; // end-of-archive zero block
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
```

- [ ] **Step 4: Run test to verify all pass**

Run: `pnpm --filter @patchwire/core test -- archive`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @patchwire/core typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/host-platform/archive.ts packages/core/src/host-platform/archive.test.ts
git commit -m "feat(core): extract mutagen binary from tar.gz and zip archives"
```

---

### Task 3: Wire extraction into the resolver (replace the guard) (TDD)

**Files:**
- Modify: `packages/core/src/host-platform/types.ts`
- Modify: `packages/core/src/host-platform/resolve-mutagen.ts`
- Test: `packages/core/src/host-platform/resolve-mutagen.test.ts`

- [ ] **Step 1: Add `extractArchive` to the DI seam in `types.ts`**

Inside `interface ResolveMutagenDeps`, after the `writeExecutable(...)` line, add:

```ts
  /** Extract the named binary from a downloaded archive (pure transform, no I/O). */
  extractArchive(archiveBytes: Buffer, archiveBinaryPath: string, format: 'tar.gz' | 'zip'): Buffer;
```

- [ ] **Step 2: Update the test fixture and replace the guard test in `resolve-mutagen.test.ts`**

First, add `extractArchive` to the `baseDeps` fixture defaults (so all existing tests still construct valid deps). Inside the object returned by `baseDeps`, add:

```ts
    extractArchive: () => Buffer.from(''),
```

Then DELETE the entire existing block:

```ts
describe('resolveMutagen — archive entries are not yet supported', () => {
  it('rejects (without downloading) when the matched entry requires archive extraction', async () => {
    ...
  });
});
```

and REPLACE it with:

```ts
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
```

- [ ] **Step 3: Run tests to verify the new one fails**

Run: `pnpm --filter @patchwire/core test -- resolve-mutagen`
Expected: FAIL — the resolver still throws the "not yet implemented" guard instead of extracting.

- [ ] **Step 4: Replace the guard with extraction in `resolve-mutagen.ts`**

At the top, add the import:

```ts
import { archiveFormat } from './archive.ts';
```

Then DELETE the guard block:

```ts
  if (entry.archiveBinaryPath) {
    throw new Error(
      `mutagen archive extraction not yet implemented for ${key}; ` +
        `install mutagen on PATH or provide a bundled binary`,
    );
  }
```

and change the tail of the function (after the checksum check) from:

```ts
  deps.writeExecutable(cached, bytes);
  return cached;
```

to:

```ts
  const fmt = archiveFormat(entry.url);
  const binary =
    fmt === 'raw' ? bytes : deps.extractArchive(bytes, entry.archiveBinaryPath ?? '', fmt);
  deps.writeExecutable(cached, binary);
  return cached;
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `pnpm --filter @patchwire/core test -- resolve-mutagen`
Expected: PASS. The raw-download test (URL has no archive extension → `raw`) still writes raw bytes and never calls `extractArchive`; the checksum-mismatch test still throws before extraction.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @patchwire/core typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/host-platform/types.ts packages/core/src/host-platform/resolve-mutagen.ts packages/core/src/host-platform/resolve-mutagen.test.ts
git commit -m "feat(core): resolveMutagen extracts archived binaries instead of failing"
```

---

### Task 4: Wire the real extractor into the Node adapter + export + end-to-end test

**Files:**
- Modify: `packages/core/src/host-platform/node-deps.ts`
- Modify: `packages/core/src/host-platform/node-deps.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the failing end-to-end test (append to `node-deps.test.ts`; extend imports)**

```ts
import { gzipSync } from 'fflate';

describe('nodeResolveMutagenDeps.extractArchive', () => {
  it('extracts a binary from a real gzipped tar end-to-end', () => {
    const enc = new TextEncoder();
    const content = enc.encode('REAL-BINARY');
    // Minimal single-entry tar (name=mutagen), then gzip.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @patchwire/core test -- node-deps`
Expected: FAIL — `extractArchive` is not on the object returned by `nodeResolveMutagenDeps`.

- [ ] **Step 3: Wire `extractArchive` into `node-deps.ts`**

Add the import near the top:

```ts
import { extractMutagenBinary } from './archive.ts';
```

Add this property to the object returned by `nodeResolveMutagenDeps` (after `writeExecutable`):

```ts
    extractArchive: (bytes, path, format) => extractMutagenBinary(bytes, path, format),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @patchwire/core test -- node-deps`
Expected: PASS.

- [ ] **Step 5: Export the extractor surface from `packages/core/src/index.ts`**

Add after the existing `resolve-mutagen` export line:

```ts
export { archiveFormat, extractMutagenBinary } from './host-platform/archive.ts';
export type { ArchiveFormat } from './host-platform/archive.ts';
```

- [ ] **Step 6: Full verify**

Run: `pnpm --filter @patchwire/core typecheck && pnpm --filter @patchwire/core test`
Expected: typecheck exit 0; all tests PASS (archive 7 + resolve-mutagen 9 + node-deps 3 = 19).

- [ ] **Step 7: Monorepo typecheck (no regressions)**

Run: `pnpm -r typecheck`
Expected: core/protocol/cli/extension all "Done", no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/host-platform/node-deps.ts packages/core/src/host-platform/node-deps.test.ts packages/core/src/index.ts
git commit -m "feat(core): wire real archive extractor into node deps + export"
```

---

## Self-review notes

- **Spec coverage:** Closes the deferred item from the resolver-slice plan ("archive extraction of the Mutagen download"); the resolver now produces a usable binary for the real archive-bearing manifest entries, completing the download tier of Core spec Pillar 4 `resolveMutagen()`.
- **Type consistency:** `extractArchive(archiveBytes, archiveBinaryPath, format)` has the identical signature in `types.ts` (Task 3), the test fixture (Task 3), and the Node adapter (Task 4). `archiveFormat`/`extractMutagenBinary`/`ArchiveFormat` names are stable from Tasks 1–2 through the barrel export in Task 4. The `'tar.gz' | 'zip'` format union matches between `extractArchive`, `extractMutagenBinary`, and the resolver's `fmt` (which narrows out `'raw'` before calling `extractArchive`).
- **Placeholder scan:** none — every code step is complete. The tar test helper deliberately omits the tar checksum field because `readTar` ignores it (documented in code), which is correct behavior, not a placeholder.
- **YAGNI:** only tar.gz + zip are implemented (the two formats Mutagen actually ships); `raw` passes through unchanged; no streaming, no multi-file extraction beyond the single named binary.

## Follow-on (still remaining in S0 after this)

Rewire the extension `MutagenController` and CLI off the hardcoded `'mutagen'` string to call `resolveMutagen` · bundle a Mutagen binary into the VSIX/npm so `bundledPath()` is non-null · fill the manifest `sha256` values for a pinned Mutagen version · CRLF/clipboard/Tailscale papercuts · rsync demotion to a Unix fast-path.
