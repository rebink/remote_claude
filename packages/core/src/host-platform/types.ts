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
