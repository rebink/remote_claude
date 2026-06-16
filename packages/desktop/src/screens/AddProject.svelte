<script lang="ts">
  import { connections } from "../lib/stores";
  import { pickFolder, writeProjectYml, initRemoteCopy, syncCommand, saveProject } from "../lib/ipc";
  import { buildProject } from "../lib/model";
  import type { Connection } from "../lib/types";

  let { connection, onfinish, onback }: { connection: Connection; onfinish?: () => void; onback?: () => void } = $props();

  // Initialise to the passed connection; the user can change it via the dropdown.
  let connId = $state<string>(connection.id);
  let localPath = $state("");
  let name = $state("");
  let remotePath = $state("");
  let busy = $state(false);
  let phase = $state("");
  let error = $state("");

  let chosen = $derived($connections.find((c) => c.id === connId) ?? connection);
  let canCreate = $derived(localPath.trim() !== "" && remotePath.trim() !== "");

  function basename(p: string): string { return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? ""; }

  async function choose() {
    const dir = await pickFolder();
    if (!dir) return;
    localPath = dir;
    name = basename(dir);
    remotePath = `~/patchwire/${name}`;
  }

  async function create() {
    error = ""; busy = true;
    try {
      phase = "Writing config…";
      await writeProjectYml({ projectDir: localPath, project: name, host: chosen.host, user: chosen.user, sshPort: chosen.sshPort, agentPort: chosen.agentPort, remotePath, token: chosen.token });
      phase = "Copying to remote…";
      await initRemoteCopy(localPath, remotePath);
      phase = "Starting sync…";
      await syncCommand(localPath, "start");
      await saveProject(buildProject(localPath, remotePath, name, chosen.host, chosen.user, chosen.id));
      onfinish?.();
    } catch (e) {
      error = `Failed: ${e}`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="add">
  <header><button class="back" onclick={() => onback?.()}>←</button><span>Add a project</span></header>

  <label>Connection
    <select aria-label="Connection" data-testid="connection-select" bind:value={connId}>
      {#each $connections as c (c.id)}<option value={c.id}>{c.name} ({c.user}@{c.host})</option>{/each}
    </select>
  </label>

  <button class="ghost" data-testid="pick-folder" onclick={choose}>Choose folder…</button>
  <label>Local path<input aria-label="Local path" data-testid="local-path" bind:value={localPath} readonly /></label>
  <label>Remote path<input aria-label="Remote path" data-testid="remote-path" bind:value={remotePath} /></label>

  {#if phase}<div class="phase" data-testid="add-phase">{phase}</div>{/if}
  {#if error}<div class="error" role="alert" data-testid="add-error">{error}</div>{/if}

  <button class="primary" data-testid="create-project" disabled={!canCreate || busy} onclick={create}>
    {busy ? "Working…" : "Create"}
  </button>
</div>

<style>
  .add { max-width: 460px; margin: 32px auto; display: flex; flex-direction: column; gap: 12px; padding: 0 20px; }
  header { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 12px; }
  .back { background: var(--surface-raised); color: var(--text); padding: 3px 9px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-muted); }
  label input, label select { color: var(--text); background: var(--surface-base); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 8px 10px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; align-self: flex-start; }
  .primary { background: var(--accent-strong); color: #fff; padding: 9px; font-weight: 600; }
  .primary:disabled { opacity: .5; cursor: not-allowed; }
  .phase { color: var(--warn); font-size: 12px; }
  .error { color: var(--error); font-size: 12px; }
</style>
