<script lang="ts">
  import { onMount } from "svelte";
  import { gitStatus } from "../lib/ipc";
  import type { ChangedEntry } from "../lib/git-status";

  let { projectDir }: { projectDir: string } = $props();
  let entries = $state<ChangedEntry[]>([]);
  let error = $state("");

  async function refresh() {
    error = "";
    try { entries = await gitStatus(projectDir); }
    catch (e) { error = `git status failed: ${e}`; }
  }
  onMount(refresh);
</script>

<div class="changes">
  <div class="row">
    <strong>Changes</strong>
    <button class="ghost" data-testid="changes-refresh" onclick={refresh}>Refresh</button>
  </div>
  {#if error}<div class="err">{error}</div>{/if}
  <ul class="body" data-testid="changes-body">
    {#if entries.length === 0}<li class="empty">No changes</li>{/if}
    {#each entries as e (e.path)}<li><span class="badge">{e.status}</span><code title={e.path}>{e.path}</code></li>{/each}
  </ul>
</div>

<style>
  .changes { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .row { display: flex; align-items: center; gap: 8px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 4px 10px; font-size: 12px; }
  .body { display: flex; flex-direction: column; gap: 4px; font-size: 12px; margin: 0; padding: 0; list-style: none; min-width: 0; }
  .body li { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .empty { color: var(--text-muted); }
  .badge { flex: 0 0 auto; min-width: 20px; color: var(--warn); font-family: monospace; }
  .err { color: var(--error); font-size: 12px; }
  code { color: var(--text); flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
</style>
