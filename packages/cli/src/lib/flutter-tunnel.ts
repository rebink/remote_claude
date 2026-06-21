// packages/cli/src/lib/flutter-tunnel.ts
// Flutter live-attach uses the generic reverse tunnel. Kept as a re-export so
// existing imports (agent/flutter) stay valid.
export {
  buildReverseTunnelArgs,
  openReverseTunnel,
  type ReverseTunnelOpts,
  type TunnelHandle,
  type TunnelSpawn,
} from './reverse-tunnel.ts';
