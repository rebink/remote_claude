<script lang="ts">
  import { onMount } from "svelte";
  import { connection, projects } from "../lib/stores";
  import { checkHealth, syncCommand } from "../lib/ipc";
  import { syncKindToProjectStatus } from "../lib/sync-events";
  import ConnectionBar from "../components/ConnectionBar.svelte";
  import ProjectRow from "../components/ProjectRow.svelte";
  import type { Project } from "../lib/types";

  let { onopen, onadd }: { onopen?: (p: Project) => void; onadd?: () => void } = $props();
  let query = $state("");
  let healthy = $state(true);

  let filtered = $derived(
    $projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
  );

  onMount(async () => {
    const conn = $connection;
    if (conn) {
      try {
        healthy = (await checkHealth(conn)).ok;
      } catch {
        healthy = false;
      }
    }
    for (const p of $projects) {
      try {
        const line = await syncCommand(p.localPath, "status");
        if (line && line.type === "status") {
          const next = syncKindToProjectStatus(line.status.kind);
          projects.update((list) => list.map((x) => (x.id === p.id ? { ...x, lastStatus: next } : x)));
        }
      } catch {
        // best-effort: leave lastStatus unchanged
      }
    }
  });
</script>

{#if $connection}
  <ConnectionBar connection={$connection} {healthy} />
{/if}

<div class="bar">
  <h2>Projects</h2>
  <button class="new" data-testid="new-project" onclick={() => onadd?.()}>＋ New project</button>
</div>

{#if $projects.length > 0}
  <input class="search" placeholder="Search projects…" bind:value={query} />
  {#each filtered as project (project.id)}
    <ProjectRow {project} {onopen} />
  {/each}
{:else}
  <div class="empty" data-testid="projects-empty">
    <p>No projects yet</p>
    <p class="sub">Add a local folder to sync it with your remote and start working.</p>
  </div>
{/if}

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 10px; }
  .bar h2 { font-size: 15px; margin: 0; }
  .new { background: var(--accent-strong); color: #fff; font-size: 12px; padding: 7px 13px; font-weight: 600; }
  .search { margin: 0 20px 10px; display: block; width: calc(100% - 40px); }
  .empty { text-align: center; color: var(--text-muted); padding: 48px 20px; }
  .empty p { margin: 4px 0; }
  .empty .sub { font-size: 13px; }
</style>
