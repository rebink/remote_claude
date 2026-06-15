<script lang="ts">
  import { pickFolder, readProjectConfig, saveProject } from "../lib/ipc";
  import { projectFromConfig } from "../lib/model";

  let { onsaved, onneedssetup, oncancel }:
    { onsaved?: () => void; onneedssetup?: (localPath: string) => void; oncancel?: () => void } = $props();
  let busy = $state(false);

  async function choose() {
    const dir = await pickFolder();
    if (!dir) return;
    busy = true;
    try {
      const cfg = await readProjectConfig(dir);
      if (cfg) {
        await saveProject(projectFromConfig(dir, cfg));
        onsaved?.();
      } else {
        onneedssetup?.(dir);
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="dialog">
  <h3>Add a project</h3>
  <p class="sub">Pick a local folder. If it's already set up, it's added immediately. Otherwise you'll be guided through setup.</p>
  <div class="actions">
    <button class="ghost" onclick={() => oncancel?.()}>Cancel</button>
    <button class="primary" data-testid="pick-folder" disabled={busy} onclick={choose}>
      {busy ? "Adding…" : "Choose folder…"}
    </button>
  </div>
</div>

<style>
  .dialog { max-width: 440px; margin: 24px auto; padding: 20px; background: var(--surface-panel);
    border: 1px solid var(--border); border-radius: var(--radius);
    display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0; }
  .sub { margin: 0; font-size: 13px; color: var(--text-muted); }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 8px 14px; font-weight: 600; }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
