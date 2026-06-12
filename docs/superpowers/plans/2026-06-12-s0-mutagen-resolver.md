# S0 — Cross-Platform Mutagen Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `@patchwire/core` package and a dependency-injected `resolveMutagen()` that returns an absolute path to a Mutagen binary on any OS, resolving PATH → bundled → checksum-verified download into `~/.patchwire/bin`.

**Architecture:** A new source-consumed workspace package `@patchwire/core` (same shape as `@patchwire/protocol`). The resolver is a pure orchestrator over an injected `ResolveMutagenDeps` seam, so all filesystem/network/PATH effects are mocked in unit tests and only thin adapters touch the real OS. This is the first slice of the `HostPlatform` adapter from the Core spec; later S0 plans rewire `MutagenController`/CLI to call it and add the CRLF/clipboard/Tailscale papercuts.

**Tech Stack:** TypeScript (ES2022, NodeNext-style source consumption), vitest, Node `node:crypto`/`node:fs`/`node:os`. No new runtime deps.

**Spec:** `docs/specs/2026-06-12-core-spec.md` (Pillar 4 — `HostPlatform.resolveMutagen()`); `docs/patchwire-v2-product-architecture-strategy.md` (S0).

---

## File structure

- `packages/core/package.json` — new workspace package `@patchwire/core` (source-consumed, like protocol).
- `packages/core/tsconfig.json` — extends `../../tsconfig.base.json`.
- `packages/core/vitest.config.ts` — vitest runner config.
- `packages/core/src/index.ts` — public barrel; re-exports the host-platform surface.
- `packages/core/src/host-platform/types.ts` — `OsArch`, `MutagenManifest*`, `ResolveMutagenDeps`, `HostPlatform` interface.
- `packages/core/src/host-platform/resolve-mutagen.ts` — `resolveMutagen()` orchestrator + `mutagenBinName()`.
- `packages/core/src/host-platform/resolve-mutagen.test.ts` — unit tests (all deps mocked).
- `packages/core/src/host-platform/node-deps.ts` — real `ResolveMutagenDeps` adapter (thin, Node built-ins).
- `packages/core/src/host-platform/mutagen-manifest.json` — pinned per-OS download URLs + sha256.

---

### Task 1: Scaffold the `@patchwire/core` package

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@patchwire/core",
  "version": "0.0.0",
  "private": true,
  "description": "UI-agnostic client core for Patchwire: HostPlatform adapter, protocol client, session/sync state.",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.3",
    "vitest": "^2.0.4"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create a placeholder barrel `packages/core/src/index.ts`**

```ts
export {};
```

- [ ] **Step 5: Install workspace deps so the package is linked**

Run: `pnpm install`
Expected: completes; `@patchwire/core` is added to the workspace (no errors).

- [ ] **Step 6: Verify the package typechecks**

Run: `pnpm --filter @patchwire/core typecheck`
Expected: exits 0 (no output / no errors).

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/vitest.config.ts packages/core/src/index.ts pnpm-lock.yaml
git commit -m "feat(core): scaffold @patchwire/core package"
```

---

### Task 2: Define HostPlatform + resolver types

**Files:**
- Create: `packages/core/src/host-platform/types.ts`

- [ ] **Step 1: Write `packages/core/src/host-platform/types.ts`**

```ts
/** Supported (platform, arch) targets for a Mutagen binary. */
export type OsArch =
  | 'darwin-x64' | 'darwin-arm64'
  | 'linux-x64'  | 'linux-arm64'
  | 'win32-x64'  | 'win32-arm64';

/** One downloadable Mutagen build, pinned by checksum. */
export interface MutagenManifestEntry {
  /** Download URL of the binary or archive. */
  url: string;
  /** Lowercase hex sha256 of the downloaded bytes (the archive, if archived). */
  sha256: string;
  /** Path of the binary inside the archive; omit/empty if the download IS the raw binary. */
  archiveBinaryPath?: string;
}

export type MutagenManifest = Partial<Record<OsArch, MutagenManifestEntry>>;

/**
 * Injected effects for resolveMutagen — every filesystem / network / PATH effect
 * is behind this seam so unit tests run with no real I/O.
 */
export interface ResolveMutagenDeps {
  platform: NodeJS.Platform;          // e.g. process.platform
  arch: string;                       // e.g. process.arch
  homeDir: string;                    // os.homedir()
  /** Absolute path if `cmd` is found on PATH, else null. */
  which(cmd: string): string | null;
  /** Absolute path to a binary bundled with the host app, if any. */
  bundledPath(): string | null;
  /** True if a file exists at `p`. */
  fileExists(p: string): boolean;
  /** Download the bytes at `url`. Rejects on non-200 / network error. */
  download(url: string): Promise<Buffer>;
  /** Lowercase hex sha256 of `buf`. */
  sha256(buf: Buffer): string;
  /** Write `buf` to `p` (creating dirs) with executable permission. */
  writeExecutable(p: string, buf: Buffer): void;
}

/** Client-side OS seam (Core spec, Pillar 4). Resolver is its first method. */
export interface HostPlatform {
  resolveMutagen(): Promise<string>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @patchwire/core typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/host-platform/types.ts
git commit -m "feat(core): add HostPlatform + Mutagen resolver types"
```

---

### Task 3: Resolve from PATH (first tier)

**Files:**
- Create: `packages/core/src/host-platform/resolve-mutagen.ts`
- Test: `packages/core/src/host-platform/resolve-mutagen.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @patchwire/core test -- resolve-mutagen`
Expected: FAIL — cannot find module `./resolve-mutagen.ts` (not yet created).

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ResolveMutagenDeps, MutagenManifest } from './types.ts';

/** Binary filename for a platform (.exe on Windows). */
export function mutagenBinName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'mutagen.exe' : 'mutagen';
}

/**
 * Resolve an absolute path to a Mutagen binary: PATH → bundled → cached → download.
 * Only the PATH tier is implemented in this task; later tiers are added next.
 */
export async function resolveMutagen(
  deps: ResolveMutagenDeps,
  _manifest: MutagenManifest,
): Promise<string> {
  const onPath = deps.which('mutagen');
  if (onPath) return onPath;

  throw new Error('mutagen could not be resolved');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @patchwire/core test -- resolve-mutagen`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/host-platform/resolve-mutagen.ts packages/core/src/host-platform/resolve-mutagen.test.ts
git commit -m "feat(core): resolveMutagen resolves from PATH"
```

---

### Task 4: Resolve from bundled path + cached download dir (second/third tier)

**Files:**
- Modify: `packages/core/src/host-platform/resolve-mutagen.ts`
- Test: `packages/core/src/host-platform/resolve-mutagen.test.ts`

- [ ] **Step 1: Add failing tests (append inside the existing test file)**

```ts
import { join } from 'node:path';

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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @patchwire/core test -- resolve-mutagen`
Expected: FAIL — bundled/cached cases reject with "could not be resolved".

- [ ] **Step 3: Extend the implementation**

```ts
import { join } from 'node:path';
import type { ResolveMutagenDeps, MutagenManifest } from './types.ts';

export function mutagenBinName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'mutagen.exe' : 'mutagen';
}

/** Absolute path of the cached binary under ~/.patchwire/bin. */
export function cachedMutagenPath(homeDir: string, platform: NodeJS.Platform): string {
  return join(homeDir, '.patchwire', 'bin', mutagenBinName(platform));
}

export async function resolveMutagen(
  deps: ResolveMutagenDeps,
  _manifest: MutagenManifest,
): Promise<string> {
  const onPath = deps.which('mutagen');
  if (onPath) return onPath;

  const bundled = deps.bundledPath();
  if (bundled) return bundled;

  const cached = cachedMutagenPath(deps.homeDir, deps.platform);
  if (deps.fileExists(cached)) return cached;

  throw new Error('mutagen could not be resolved');
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm --filter @patchwire/core test -- resolve-mutagen`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/host-platform/resolve-mutagen.ts packages/core/src/host-platform/resolve-mutagen.test.ts
git commit -m "feat(core): resolveMutagen resolves from bundled + cached binary"
```

---

### Task 5: Download + checksum-verify (final tier)

**Files:**
- Modify: `packages/core/src/host-platform/resolve-mutagen.ts`
- Test: `packages/core/src/host-platform/resolve-mutagen.test.ts`

- [ ] **Step 1: Add failing tests (append to the test file)**

```ts
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @patchwire/core test -- resolve-mutagen`
Expected: FAIL — download tier not implemented.

- [ ] **Step 3: Extend the implementation (full file)**

```ts
import { join } from 'node:path';
import type { ResolveMutagenDeps, MutagenManifest, OsArch } from './types.ts';

export function mutagenBinName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'mutagen.exe' : 'mutagen';
}

export function cachedMutagenPath(homeDir: string, platform: NodeJS.Platform): string {
  return join(homeDir, '.patchwire', 'bin', mutagenBinName(platform));
}

/** Map Node platform+arch to a manifest key, or null if unsupported. */
export function osArchKey(platform: NodeJS.Platform, arch: string): OsArch | null {
  const p = platform === 'darwin' || platform === 'linux' || platform === 'win32' ? platform : null;
  const a = arch === 'x64' || arch === 'arm64' ? arch : null;
  if (!p || !a) return null;
  return `${p}-${a}` as OsArch;
}

export async function resolveMutagen(
  deps: ResolveMutagenDeps,
  manifest: MutagenManifest,
): Promise<string> {
  const onPath = deps.which('mutagen');
  if (onPath) return onPath;

  const bundled = deps.bundledPath();
  if (bundled) return bundled;

  const cached = cachedMutagenPath(deps.homeDir, deps.platform);
  if (deps.fileExists(cached)) return cached;

  const key = osArchKey(deps.platform, deps.arch);
  const entry = key ? manifest[key] : undefined;
  if (!key || !entry) {
    throw new Error(`no mutagen build for ${key ?? `${deps.platform}-${deps.arch}`}`);
  }

  const bytes = await deps.download(entry.url);
  const got = deps.sha256(bytes);
  if (got !== entry.sha256) {
    throw new Error(`mutagen checksum mismatch: expected ${entry.sha256}, got ${got}`);
  }
  deps.writeExecutable(cached, bytes);
  return cached;
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm --filter @patchwire/core test -- resolve-mutagen`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/host-platform/resolve-mutagen.ts packages/core/src/host-platform/resolve-mutagen.test.ts
git commit -m "feat(core): resolveMutagen downloads + checksum-verifies binary"
```

---

### Task 6: Real Node deps adapter + manifest + barrel export

**Files:**
- Create: `packages/core/src/host-platform/node-deps.ts`
- Create: `packages/core/src/host-platform/mutagen-manifest.json`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/host-platform/node-deps.test.ts`

- [ ] **Step 1: Create the pinned manifest `packages/core/src/host-platform/mutagen-manifest.json`**

> Data step (not a code placeholder): fill each `sha256` from the official Mutagen release you pin. To get a value: download the asset and run `shasum -a 256 <file>`. Pin one known-good Mutagen version across all entries. Leave only entries for targets you ship; unsupported targets are simply absent (the resolver throws an actionable error for them).

```json
{
  "darwin-arm64": { "url": "https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_darwin_arm64_v0.18.1.tar.gz", "sha256": "FILL_FROM_RELEASE", "archiveBinaryPath": "mutagen" },
  "darwin-x64":   { "url": "https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_darwin_amd64_v0.18.1.tar.gz", "sha256": "FILL_FROM_RELEASE", "archiveBinaryPath": "mutagen" },
  "linux-x64":    { "url": "https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_amd64_v0.18.1.tar.gz", "sha256": "FILL_FROM_RELEASE", "archiveBinaryPath": "mutagen" },
  "linux-arm64":  { "url": "https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_arm64_v0.18.1.tar.gz", "sha256": "FILL_FROM_RELEASE", "archiveBinaryPath": "mutagen" },
  "win32-x64":    { "url": "https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_windows_amd64_v0.18.1.zip", "sha256": "FILL_FROM_RELEASE", "archiveBinaryPath": "mutagen.exe" }
}
```

> NOTE: `archiveBinaryPath` is set because Mutagen ships as an archive. Extraction is added in the follow-on plan that wires the resolver into real download; this task wires the deps adapter for the raw-bytes path and the manifest is committed ready. Until extraction lands, `download()` is treated as returning the binary bytes (the unit tests already cover that contract); the adapter below is structured so extraction slots in without changing `resolveMutagen`.

- [ ] **Step 2: Write the failing test for the Node deps adapter**

```ts
import { describe, it, expect } from 'vitest';
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @patchwire/core test -- node-deps`
Expected: FAIL — cannot find `./node-deps.ts`.

- [ ] **Step 4: Implement the Node deps adapter `packages/core/src/host-platform/node-deps.ts`**

```ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ResolveMutagenDeps } from './types.ts';

/** Look up `cmd` on PATH without shelling out to which/where. */
function whichOnPath(cmd: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function nodeResolveMutagenDeps(opts: {
  bundledPath: () => string | null;
  download?: (url: string) => Promise<Buffer>;
}): ResolveMutagenDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    homeDir: homedir(),
    which: whichOnPath,
    bundledPath: opts.bundledPath,
    fileExists: (p) => existsSync(p),
    download:
      opts.download ??
      (async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
        return Buffer.from(await res.arrayBuffer());
      }),
    sha256: (buf) => createHash('sha256').update(buf).digest('hex'),
    writeExecutable: (p, buf) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, buf, { mode: 0o755 });
    },
  };
}
```

> NOTE: `spawnSync` is imported for parity with existing code style but is not used here; remove the import if your lint flags it. (Left out of `whichOnPath` deliberately — the PATH scan avoids spawning a process.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @patchwire/core test -- node-deps`
Expected: PASS (2 tests).

- [ ] **Step 6: Export the public surface from the barrel `packages/core/src/index.ts`**

```ts
export type {
  OsArch,
  MutagenManifest,
  MutagenManifestEntry,
  ResolveMutagenDeps,
  HostPlatform,
} from './host-platform/types.ts';
export { resolveMutagen, mutagenBinName, cachedMutagenPath, osArchKey } from './host-platform/resolve-mutagen.ts';
export { nodeResolveMutagenDeps } from './host-platform/node-deps.ts';
```

- [ ] **Step 7: Remove the unused `spawnSync` import if present, then typecheck + full test run**

Run: `pnpm --filter @patchwire/core typecheck && pnpm --filter @patchwire/core test`
Expected: typecheck exits 0; all tests PASS (10 total).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/host-platform/node-deps.ts packages/core/src/host-platform/node-deps.test.ts packages/core/src/host-platform/mutagen-manifest.json packages/core/src/index.ts
git commit -m "feat(core): add Node deps adapter, pinned manifest, and public barrel"
```

---

## What this plan deliberately leaves to follow-on S0 plans

- **Archive extraction** of the Mutagen download (tar.gz / zip → binary). The manifest already records `archiveBinaryPath`; the resolver contract (returns/writes binary bytes) is unchanged when extraction is inserted in `download`/`writeExecutable`.
- **Rewiring** `MutagenController` (extension) and the CLI to call `resolveMutagen()` instead of the hardcoded `'mutagen'` string, and **bundling** a Mutagen binary into the VSIX/npm artifact so `bundledPath()` is non-null.
- **Papercuts:** CRLF patch normalization, Windows/Linux clipboard capture, Tailscale path discovery — the rest of `HostPlatform`.
- **rsync demotion** to a Unix-only fast-path.

Each is its own plan producing working, testable software.

## Self-review notes

- **Spec coverage:** Core spec Pillar 4 `resolveMutagen()` (PATH → bundled → checksum download to `~/.patchwire/bin`) is fully covered by Tasks 3–6; the broader `HostPlatform` methods (clipboard, tooling discovery, patch normalization) are explicitly deferred above, matching the plan's scoped slice.
- **Type consistency:** `ResolveMutagenDeps`, `MutagenManifest`, `OsArch`, and the `resolveMutagen(deps, manifest)` signature are identical across Tasks 2–6; `mutagenBinName`/`cachedMutagenPath`/`osArchKey` names are stable from introduction through the barrel export.
- **Placeholder scan:** the only `FILL_FROM_RELEASE` tokens are in a JSON **data** file with an explicit how-to-obtain step (checksums are release data the engineer fetches), not code placeholders; all code steps contain complete implementations.
