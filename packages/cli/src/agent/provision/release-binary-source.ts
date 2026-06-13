import { createHash } from 'node:crypto';
import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { BinaryArtifact, BinaryArtifactSource } from './binary-installer.ts';

/** Minimal fetch surface this source needs (injected for testing). */
export type FetchLike = (url: string) => Promise<{
  ok: boolean; status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): Promise<any>;
}>;

/** detected.os → release asset OS token (matches scripts/build-agent-binaries.mjs). */
const OS_TOKEN: Record<string, string> = { macos: 'darwin', linux: 'linux' };

const REPO = 'rebink/remote_claude';

/**
 * Release asset filename for an os/arch. THIS IS THE NAMING CONTRACT shared with
 * scripts/build-agent-binaries.mjs — keep them in sync. Throws for an os with no
 * standalone binary (e.g. windows).
 */
export function assetName(os: string, arch: string): string {
  const token = OS_TOKEN[os];
  if (!token) throw new Error(`no standalone agent binary for os "${os}"`);
  return `patchwire-agent-${token}-${arch}`;
}

export interface ReleaseBinarySourceOpts {
  version: string;
  /** Base URL the release assets live under (default: the GitHub release download URL). */
  baseUrl?: string;
  fetch?: FetchLike;
}

/**
 * A BinaryArtifactSource that downloads the os/arch-matching standalone agent
 * binary from a GitHub release and verifies it against the release manifest's
 * sha256. Pairs with binaryInstaller (it yields the bytes; the installer ships
 * them over SSH).
 */
export function releaseBinarySource(opts: ReleaseBinarySourceOpts): BinaryArtifactSource {
  const base = (opts.baseUrl ?? `https://github.com/${REPO}/releases/download/v${opts.version}`).replace(/\/$/, '');
  const doFetch: FetchLike = opts.fetch ?? (async (url) => {
    const { fetch } = await import('undici');
    return fetch(url) as unknown as Awaited<ReturnType<FetchLike>>;
  });
  return async (detected: DetectedServerPlatform): Promise<BinaryArtifact> => {
    const token = OS_TOKEN[detected.os];
    const name = assetName(detected.os, detected.arch); // throws on unsupported os
    const mres = await doFetch(`${base}/manifest.json`);
    if (!mres.ok) throw new Error(`could not fetch release manifest (HTTP ${mres.status})`);
    const manifest = await mres.json();
    const entry = manifest?.binaries?.[`${token}-${detected.arch}`];
    if (!entry?.sha256) throw new Error(`release manifest has no entry for ${detected.os}-${detected.arch}`);
    const bres = await doFetch(`${base}/${name}`);
    if (!bres.ok) throw new Error(`could not download ${name} (HTTP ${bres.status})`);
    const bytes = Buffer.from(await bres.arrayBuffer());
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== String(entry.sha256).toLowerCase()) {
      throw new Error(`sha256 mismatch for ${name}: manifest ${entry.sha256}, downloaded ${actual}`);
    }
    return { bytes, sha256: actual, version: manifest.version ?? opts.version };
  };
}
