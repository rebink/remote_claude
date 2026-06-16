<script lang="ts">
  import { connections, loadConnections } from "../lib/stores";
  import { deleteConnection } from "../lib/ipc";
  import type { Connection } from "../lib/types";

  let { onselect, onadd }: { onselect?: (c: Connection) => void; onadd?: () => void } = $props();

  async function remove(id: string, e: Event) {
    e.stopPropagation();
    await deleteConnection(id);
    await loadConnections();
  }
</script>

<div class="bar">
  <h2>Connections</h2>
  <button class="new" data-testid="add-connection" onclick={() => onadd?.()}>＋ Add connection</button>
</div>

{#if $connections.length === 0}
  <div class="empty" data-testid="connections-empty">
    <p>No connections yet</p>
    <p class="sub">Add a machine to provision the agent and start working.</p>
  </div>
{:else}
  <div class="list">
    {#each $connections as c (c.id)}
      <div class="row" data-testid="conn-row-{c.id}" role="button" tabindex="0"
        onclick={() => onselect?.(c)} onkeydown={(e) => e.key === "Enter" && onselect?.(c)}>
        <div class="ic">🖥</div>
        <div class="body">
          <div class="name">{c.name}</div>
          <div class="sub mono">{c.user}@{c.host}{#if c.agentVersion} · agent v{c.agentVersion}{/if}</div>
        </div>
        <button class="del" data-testid="conn-del-{c.id}" onclick={(e) => remove(c.id, e)}>Remove</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 10px; }
  .bar h2 { font-size: 15px; margin: 0; }
  .new { background: var(--accent-strong); color: #fff; font-size: 12px; padding: 7px 13px; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 14px; padding: 14px 20px; border-top: 1px solid var(--border); cursor: pointer; }
  .row:hover { background: var(--surface-raised); }
  .ic { width: 38px; height: 38px; border-radius: 10px; background: var(--accent-bg); display: flex; align-items: center; justify-content: center; }
  .name { font-weight: 600; }
  .sub { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
  .del { margin-left: auto; background: var(--surface-raised); color: var(--text-muted); font-size: 11px; padding: 5px 10px; }
  .empty { text-align: center; color: var(--text-muted); padding: 48px 20px; }
  .empty .sub { font-size: 13px; }
</style>
