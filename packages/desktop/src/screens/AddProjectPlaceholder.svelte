<script lang="ts">
  import type { Connection } from "../lib/types";
  let { connection, onback }: { connection: Connection; onback?: () => void } = $props();
</script>
<div class="ph" data-testid="addproject-placeholder">
  <h2>Add a project</h2>
  <p class="sub">on {connection.user}@{connection.host}</p>
  <p>The folder → remote copy + sync flow lands in P5b.</p>
  <button class="ghost" onclick={() => onback?.()}>Back</button>
</div>
<style>
  .ph { max-width: 440px; margin: 48px auto; text-align: center; display: flex; flex-direction: column; gap: 10px; }
  .sub { color: var(--text-muted); font-size: 13px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; align-self: center; }
</style>
