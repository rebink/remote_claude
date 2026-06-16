<script lang="ts">
  import { onMount } from "svelte";
  import { projects } from "../lib/stores";
  import { syncCommand } from "../lib/ipc";
  import { syncKindToProjectStatus } from "../lib/sync-events";
  import ProjectRow from "../components/ProjectRow.svelte";
  import type { Project, Connection } from "../lib/types";

  let { connection, onopen, onadd, onback }:
    { connection: Connection; onopen?: (p: Project) => void; onadd?: () => void; onback?: () => void } = $props();
  let query = $state("");
  let mine = $derived($projects.filter((p) => p.connectionId === connection.id));
  let filtered = $derived(mine.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())));

  onMount(async () => {
    for (const p of $projects.filter((x) => x.connectionId === connection.id)) {
      try {
        const line = await syncCommand(p.localPath, "status");
        if (line && line.type === "status") {
          const next = syncKindToProjectStatus(line.status.kind);
          projects.update((list) => list.map((x) => (x.id === p.id ? { ...x, lastStatus: next } : x)));
        }
      } catch { /* best-effort */ }
    }
  });
</script>

<div class="bar">
  <button class="back" data-testid="proj-back" onclick={() => onback?.()}>←</button>
  <h2>{connection.name}</h2>
  <button class="new" data-testid="new-project" onclick={() => onadd?.()}>＋ New</button>
  <input class="search" type="text" placeholder="Search…" bind:value={query} />
</div>

{#if filtered.length === 0}
  <div class="empty" data-testid="projects-empty">
    <p>No projects yet</p>
    <p class="sub">Add a folder to set up your first project.</p>
  </div>
{:else}
  <div class="list">
    {#each filtered as p (p.id)}
      <ProjectRow project={p} onopen={(proj) => onopen?.(proj)} />
    {/each}
  </div>
{/if}

<style>
  .bar { display: flex; align-items: center; gap: 12px; padding: 16px 20px 10px; }
  .bar h2 { font-size: 15px; margin: 0; flex: none; }
  .back { background: var(--surface-raised); color: var(--text); font-size: 14px; padding: 6px 10px; }
  .new { background: var(--accent-strong); color: #fff; font-size: 12px; padding: 7px 13px; font-weight: 600; }
  .search { flex: 1; }
  .empty { text-align: center; color: var(--text-muted); padding: 48px 20px; }
  .empty .sub { font-size: 13px; }
</style>
