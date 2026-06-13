import type { DetectedServerPlatform } from '../server-platform/types.ts';
import type { AgentInstaller, RemoteConn, RemoteRunner } from './installer.ts';
import { defaultRemoteRunner } from './installer.ts';
import {
  buildWindowsBinaryInstallPs,
  WINDOWS_BIN_VERSION_CMD,
  REMOVE_WINDOWS_BIN_PS,
} from './windows-primitives.ts';

/** Absolute path where the standalone agent binary lives on the remote. */
export const REMOTE_BIN_PATH = '$HOME/.patchwire/bin/patchwire-agent';

/**
 * A pre-built standalone binary ready to be shipped to a remote host.
 * `bytes` is the raw binary content; `sha256` is its lowercase hex digest
 * (verified on the remote after transfer); `version` is surfaced by
 * check/version after install.
 */
export interface BinaryArtifact {
  bytes: Buffer;
  sha256: string;
  version?: string;
}

/**
 * Injected so binary PRODUCTION (Node SEA / bun compile / release download)
 * is a future plug-in, not a rewrite; this installer only transports +
 * verifies what the source yields.
 */
export type BinaryArtifactSource = (detected: DetectedServerPlatform) => Promise<BinaryArtifact>;

/** Dependencies injected into `binaryInstaller`. */
export interface BinaryInstallerDeps {
  source: BinaryArtifactSource;
  detected: DetectedServerPlatform;
  runner?: RemoteRunner;
}

/** Module-level guard: a valid sha256 hex digest is exactly 64 lowercase hex chars. */
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Prerequisite-free installer: copies a standalone binary over SSH (base64 via
 * stdin → openssl decode) and verifies its sha256 on the remote before
 * promoting it into place. Implements `AgentInstaller` so it drops into the
 * executor's existing `opts.installer` override.
 */
export function binaryInstaller(conn: RemoteConn, deps: BinaryInstallerDeps): AgentInstaller {
  const runner = deps.runner ?? defaultRemoteRunner(conn);

  async function version(): Promise<string | null> {
    if (deps.detected.os === 'windows') {
      const r = await runner(WINDOWS_BIN_VERSION_CMD);
      return r.code === 0 ? r.stdout.trim() : null;
    }
    const r = await runner(`"${REMOTE_BIN_PATH}" --version`);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async function uninstall() {
    if (deps.detected.os === 'windows') {
      const r = await runner(REMOVE_WINDOWS_BIN_PS);
      return r.code === 0
        ? { ok: true as const, detail: 'removed' }
        : { ok: false as const, detail: (r.stderr || r.stdout || 'uninstall failed').trim() };
    }
    const r = await runner(`rm -f "${REMOTE_BIN_PATH}"`);
    return r.code === 0
      ? { ok: true as const, detail: 'removed' }
      : { ok: false as const, detail: (r.stderr || r.stdout || 'uninstall failed').trim() };
  }

  return {
    version,
    uninstall,

    async check() {
      const v = await version();
      return v === null ? { present: false } : { present: true, version: v };
    },

    async install() {
      const art = await deps.source(deps.detected);
      const sha = art.sha256.toLowerCase();

      if (!HEX64.test(sha)) {
        return { result: { ok: false, detail: `invalid artifact sha256 (${art.sha256})` } };
      }

      const payload = art.bytes.toString('base64');

      if (deps.detected.os === 'windows') {
        const r = await runner(buildWindowsBinaryInstallPs(sha), payload);
        if (r.code !== 0) {
          return {
            result: {
              ok: false,
              detail: (r.stderr || r.stdout || 'binary install failed (copy or sha256 mismatch)').trim(),
            },
          };
        }
        return {
          result: {
            ok: true,
            detail: `installed standalone binary${art.version ? ` ${art.version}` : ''} (sha256 verified)`,
          },
          compensate: async () => {
            await runner(REMOVE_WINDOWS_BIN_PS);
          },
        };
      }

      const script =
        `umask 077; mkdir -p "$HOME/.patchwire/bin" ` +
        `&& openssl base64 -A -d > "${REMOTE_BIN_PATH}.tmp" ` +
        `&& ACTUAL=$(openssl dgst -sha256 "${REMOTE_BIN_PATH}.tmp" | awk '{print $NF}') ` +
        `&& [ "$ACTUAL" = "${sha}" ] ` +
        `&& chmod 700 "${REMOTE_BIN_PATH}.tmp" ` +
        `&& mv -f "${REMOTE_BIN_PATH}.tmp" "${REMOTE_BIN_PATH}"`;

      const r = await runner(script, payload);

      if (r.code !== 0) {
        return {
          result: {
            ok: false,
            detail: (r.stderr || r.stdout || 'binary install failed (copy or sha256 mismatch)').trim(),
          },
        };
      }

      return {
        result: {
          ok: true,
          detail: `installed standalone binary${art.version ? ` ${art.version}` : ''} (sha256 verified)`,
        },
        compensate: async () => {
          await uninstall();
        },
      };
    },
  };
}
