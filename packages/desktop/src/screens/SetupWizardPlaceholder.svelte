<script lang="ts">
  let { localPath, onback }: { localPath: string; onback?: () => void } = $props();
</script>
<div class="ph" data-testid="setup-placeholder">
  <h2>Set up a project</h2>
  <p class="sub mono">{localPath}</p>
  <p>The guided setup wizard lands in P4b.</p>
  <button class="ghost" onclick={() => onback?.()}>Back</button>
</div>
<style>
  .ph { max-width: 440px; margin: 48px auto; text-align: center; display: flex; flex-direction: column; gap: 10px; }
  .sub { color: var(--text-muted); font-size: 12px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; align-self: center; }
</style>
