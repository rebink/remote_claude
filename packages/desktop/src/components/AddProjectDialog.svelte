<script lang="ts">
  import { pickFolder, saveProject } from "../lib/ipc";
  import { buildProject } from "../lib/model";

  let { onsaved, oncancel }: { onsaved?: () => void; oncancel?: () => void } = $props();

  let localPath = $state("");
  let remotePath = $state("");
  let name = $state("");
  let busy = $state(false);

  let canSave = $derived(localPath.trim() !== "" && remotePath.trim() !== "");

  async function choose() {
    const dir = await pickFolder();
    if (dir) {
      localPath = dir;
      if (!name) name = dir.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
    }
  }

  async function save() {
    busy = true;
    try {
      const project = buildProject(localPath, remotePath, name);
      await saveProject(project);
      onsaved?.();
    } finally {
      busy = false;
    }
  }
</script>

<div class="dialog">
  <h3>New project</h3>
  <button class="ghost" data-testid="pick-folder" onclick={choose}>Choose local folder…</button>
  <label>Local path<input aria-label="Local path" data-testid="local-path" bind:value={localPath} readonly /></label>
  <label>Remote path<input aria-label="Remote path" data-testid="remote-path" bind:value={remotePath} placeholder="/remote/project" /></label>
  <label>Name<input aria-label="Name" data-testid="project-name" bind:value={name} placeholder="optional" /></label>
  <div class="actions">
    <button class="ghost" onclick={() => oncancel?.()}>Cancel</button>
    <button class="primary" data-testid="save-project" disabled={!canSave || busy} onclick={save}>
      {busy ? "Saving…" : "Add project"}
    </button>
  </div>
</div>

<style>
  .dialog { max-width: 440px; margin: 24px auto; padding: 20px; background: var(--surface-panel);
    border: 1px solid var(--border); border-radius: var(--radius);
    display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-muted); }
  label input { color: var(--text); }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 8px 14px; font-weight: 600; }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
