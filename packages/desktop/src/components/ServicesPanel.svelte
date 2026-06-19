<script lang="ts">
  import { onMount } from "svelte";
  import type { Project } from "../lib/types";
  import { startServices, servicesSend, stopServices, onServicesEvent, detectVmUri, saveProject } from "../lib/ipc";
  import { reduceServices, parseServicesLine, initialServices, type ServicesView } from "../lib/services-session";

  let { project }: { project: Project } = $props();
  let view = $state<ServicesView>(initialServices);
  let bound = $state<Set<string>>(new Set(project.boundServiceIds ?? []));

  onMount(() => {
    let un: (() => void) | undefined;
    (async () => {
      un = await onServicesEvent((line) => {
        const ev = parseServicesLine(line);
        if (ev) view = reduceServices(view, ev);
      });
      const vmUri = (await detectVmUri()) ?? undefined;
      await startServices(project.localPath, vmUri);
      await servicesSend({ cmd: "discover" });
      for (const id of bound) await servicesSend({ cmd: "bind", id });
    })();
    return () => { un?.(); stopServices(); };
  });

  function statusOf(id: string): string {
    const p = view.projections.find((p) => p.service.id === id);
    return p ? p.status : "available";
  }
  function remoteOf(id: string): string | null {
    const p = view.projections.find((p) => p.service.id === id);
    return p ? `127.0.0.1:${p.remotePort}` : null;
  }

  async function persist() {
    await saveProject({ ...project, boundServiceIds: [...bound] });
  }
  async function toggle(id: string) {
    if (bound.has(id)) { bound.delete(id); await servicesSend({ cmd: "unbind", id }); }
    else { bound.add(id); await servicesSend({ cmd: "bind", id }); }
    bound = new Set(bound);
    await persist();
  }
  async function retry(id: string) { await servicesSend({ cmd: "retry", id }); }
  function copy(text: string) { navigator.clipboard?.writeText(text); }
</script>

<div class="services-panel">
  <header><span class="h">Services</span>{#if view.error}<span class="err" data-testid="services-error">{view.error}</span>{/if}</header>
  {#if view.candidates.length === 0}
    <p class="empty" data-testid="services-empty">No local services discovered.</p>
  {:else}
    <ul class="list">
      {#each view.candidates as s (s.id)}
        {@const st = statusOf(s.id)}
        <li class="row" data-testid="svc-{s.id}">
          <label class="tog">
            <input type="checkbox" checked={bound.has(s.id)} onchange={() => toggle(s.id)} aria-label="bind {s.label}" />
            <span class="label">{s.label}</span>
          </label>
          <span class="pill pill-{st}">{st}</span>
          {#if remoteOf(s.id)}
            <button class="copy" onclick={() => copy(remoteOf(s.id)!)} title="Copy remote address">{remoteOf(s.id)}</button>
          {/if}
          {#if st === "failed" || st === "stale"}
            <button class="retry" onclick={() => retry(s.id)}>Retry</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .services-panel { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--border); }
  header { display: flex; align-items: center; gap: 8px; }
  .h { font-weight: 600; font-size: 13px; }
  .err { color: var(--error); font-size: 11px; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .tog { display: flex; align-items: center; gap: 6px; flex: 1; }
  .pill { font-size: 10px; padding: 1px 7px; border-radius: 20px; border: 1px solid var(--border); text-transform: capitalize; }
  .pill-active { background: var(--accent-bg); }
  .pill-failed, .pill-stale { color: var(--error); }
  .copy { font-family: monospace; font-size: 11px; background: var(--surface-raised); color: var(--text-muted); padding: 2px 8px; }
  .retry { background: var(--surface-raised); color: var(--text); padding: 2px 8px; }
  .empty { color: var(--text-muted); font-size: 12px; }
</style>
