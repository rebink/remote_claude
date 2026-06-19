// packages/cli/src/services/transport-ssh.ts
import { openReverseTunnel, type TunnelSpawn } from '../lib/reverse-tunnel.ts';
import type { SshTarget, Transport } from './types.ts';

/** A Transport that carries each service over a `ssh -R` reverse tunnel. */
export function makeSshTransport(target: SshTarget, spawnAdapter?: TunnelSpawn): Transport {
  return {
    open(o, onClose) {
      return openReverseTunnel(
        { ...target, remotePort: o.remotePort, localPort: o.localPort },
        spawnAdapter,
        onClose,
      );
    },
  };
}
