// packages/cli/src/services/mirror.ts
import type { Transport, TunnelHandle } from './types.ts';

/** Try the local port first, then deterministic fallbacks in the 49200+ range. */
export function candidateRemotePorts(localPort: number, count = 5): number[] {
  const out = [localPort];
  let p = 49200;
  while (out.length < count) {
    if (p !== localPort) out.push(p);
    p++;
  }
  return out;
}

export interface StableResult {
  handle: TunnelHandle;
  remotePort: number;
  mirrored: boolean;
}

interface FirstStableOpts {
  /** Resolves after the probe window; lets the test inject a no-op wait. */
  probe?: () => Promise<void>;
  candidates?: number;
}

const realProbe = () => new Promise<void>((r) => setTimeout(r, 400));

/**
 * Open candidate remote ports until one tunnel stays up past the probe window.
 * A non-zero `onClose` during the window means the remote port was taken.
 */
export async function firstStablePort(
  transport: Transport,
  localPort: number,
  opts: FirstStableOpts = {},
): Promise<StableResult> {
  const probe = opts.probe ?? realProbe;
  const ports = candidateRemotePorts(localPort, opts.candidates ?? 5);
  for (const remotePort of ports) {
    let closedCode: number | null | undefined;
    const handle = transport.open({ localPort, remotePort }, (code) => { closedCode = code; });
    await probe();
    if (closedCode === undefined) {
      return { handle, remotePort, mirrored: remotePort === localPort };
    }
    handle.stop();
  }
  throw new Error(`no free remote port for local ${localPort}`);
}
