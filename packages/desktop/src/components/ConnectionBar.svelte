<script lang="ts">
  import type { Connection } from "../lib/types";
  let { connection, healthy }: { connection: Connection; healthy: boolean } = $props();
</script>

<div class="bar">
  <div class="mac">🖥</div>
  <div class="meta">
    <div class="who" data-testid="conn-who">{connection.user}@{connection.host}</div>
    <div class="sub" data-testid="conn-sub">
      {connection.tailnetAddr ?? "tailnet"} · agent v{connection.agentVersion ?? "?"}
    </div>
  </div>
  <div class="status {healthy ? 'ok' : 'bad'}" data-testid="conn-status">
    <span class="dot"></span>{healthy ? "Connected" : "Unreachable"}
  </div>
</div>

<style>
  .bar { display: flex; align-items: center; gap: 12px; padding: 14px 20px;
    background: var(--surface-panel); border-bottom: 1px solid var(--border); }
  .mac { width: 34px; height: 34px; border-radius: 9px; background: var(--accent-bg);
    display: flex; align-items: center; justify-content: center; }
  .who { font-weight: 600; }
  .sub { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
  .status { margin-left: auto; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .status.ok { color: var(--ok); }
  .status.bad { color: var(--error); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .status.ok .dot { box-shadow: 0 0 8px var(--ok); }
</style>
