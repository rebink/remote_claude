<script lang="ts">
  import { connections } from "../lib/stores";
  import { pickFolder, writeProjectYml, initRemoteCopy, syncCommand, saveProject, computerName, type InitRemoteMode } from "../lib/ipc";
  import { slugifySegment } from "../lib/slug";
  import { buildProject } from "../lib/model";
  import type { Connection } from "../lib/types";
  import { onMount } from "svelte";

  let { connection, onfinish, onback }: { connection: Connection; onfinish?: () => void; onback?: () => void } = $props();

  // Initialise to the passed connection; the user can change it via the dropdown.
  let connId = $state<string>(connection.id);
  let localPath = $state("");
  let name = $state("");
  let remotePath = $state("");
  let busy = $state(false);
  let phase = $state("");
  let error = $state("");
  let computer = $state("");
  let existsPrompt = $state(false);

  let chosen = $derived($connections.find((c) => c.id === connId) ?? connection);
  let canCreate = $derived(localPath.trim() !== "" && remotePath.trim() !== "");

  onMount(() => { computerName().then((v) => (computer = v)); });

  function basename(p: string): string { return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? ""; }

  async function choose() {
    const dir = await pickFolder();
    if (!dir) return;
    localPath = dir;
    name = basename(dir);
    const seg = slugifySegment(computer) || chosen.user;
    remotePath = `~/patchwire/${seg}/${name}`;
  }

  // Copy step, re-runnable with a different mode after a target_exists prompt.
  async function runCopy(mode: InitRemoteMode) {
    phase = "Copying to remote…";
    const r = await initRemoteCopy(localPath, remotePath, mode);
    if (r.ok) {
      phase = "Starting sync…";
      await syncCommand(localPath, "start");
      await saveProject(buildProject(localPath, remotePath, name, chosen.host, chosen.user, chosen.id));
      onfinish?.();
      return;
    }
    if (r.code === "target_exists") { existsPrompt = true; busy = false; return; }
    error = `Failed: ${r.stderr ?? r.code}`;
    busy = false;
  }

  async function create() {
    error = ""; existsPrompt = false; busy = true;
    try {
      phase = "Writing config…";
      await writeProjectYml({ projectDir: localPath, project: name, host: chosen.host, user: chosen.user, sshPort: chosen.sshPort, agentPort: chosen.agentPort, remotePath, token: chosen.token });
      await runCopy("create");
    } catch (e) {
      error = `Failed: ${e}`;
      busy = false;
    }
  }

  async function chooseExisting(mode: InitRemoteMode) {
    existsPrompt = false; error = ""; busy = true;
    try { await runCopy(mode); } catch (e) { error = `Failed: ${e}`; busy = false; }
  }

  function cancelExists() { existsPrompt = false; busy = false; error = "Cancelled: target exists on remote."; }
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

  {#if existsPrompt}
    <div class="exists-modal" data-testid="exists-modal" role="dialog" aria-label="Remote path exists">
      <p>{remotePath} already exists on the remote.</p>
      <div class="exists-actions">
        <button class="primary" data-testid="exists-overwrite" onclick={() => chooseExisting("overwrite")}>Overwrite (rm -rf + re-push)</button>
        <button data-testid="exists-use-existing" onclick={() => chooseExisting("use_existing")}>Use existing (skip copy)</button>
        <button class="ghost" data-testid="exists-cancel" onclick={cancelExists}>Cancel</button>
      </div>
    </div>
  {/if}

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
  .exists-modal { border: 1px solid var(--border-strong); background: var(--surface-raised); border-radius: var(--radius-sm); padding: 12px; display: flex; flex-direction: column; gap: 10px; font-size: 12px; color: var(--text); }
  .exists-actions { display: flex; flex-direction: column; gap: 6px; }
  .exists-actions button { padding: 8px 10px; }
</style>
