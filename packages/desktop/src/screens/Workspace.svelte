<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Project } from "../lib/types";
  import { connections } from "../lib/stores";
  import { startSyncWatch, stopSyncWatch, onSyncEvent, syncCommand } from "../lib/ipc";
  import SessionLauncher from "../components/SessionLauncher.svelte";
  import AttachPanel from "../components/AttachPanel.svelte";
  import ChangesList from "../components/ChangesList.svelte";
  import FlutterPanel from "../components/FlutterPanel.svelte";
  import SyncPill from "../components/SyncPill.svelte";
  import type { SyncStatus } from "../lib/sync-events";
  import type { UnlistenFn } from "@tauri-apps/api/event";

  let { project, onback }: { project: Project; onback?: () => void } = $props();

  let sync = $state<SyncStatus>({ kind: "no_session", conflicts: [] });
  let unlistenSync: UnlistenFn | null = null;

  let connection = $derived($connections.find((c) => c.id === project.connectionId));

  onMount(async () => {
    unlistenSync = await onSyncEvent((l) => { if (l.type === "status") sync = l.status; });
    try { await startSyncWatch(project.localPath); } catch { /* surfaced via pill */ }
  });
  onDestroy(() => { unlistenSync?.(); stopSyncWatch(); });

  async function toggleSync() {
    const sub = sync.kind === "paused" ? "resume" : "pause";
    await syncCommand(project.localPath, sub);
    const line = await syncCommand(project.localPath, "status");
    if (line && line.type === "status") sync = line.status;
  }
</script>

<div class="ws">
  <header class="ws-head">
    <button class="back" data-testid="ws-back" onclick={() => onback?.()}>←</button>
    <span class="title" data-testid="ws-title">{project.name} <span class="branch">{project.branch}</span></span>
    <span class="ws-sync">
      <SyncPill status={sync} />
      <button class="ghost" data-testid="sync-pause" onclick={toggleSync}>
        {sync.kind === "paused" ? "Resume" : "Pause"}
      </button>
    </span>
  </header>

  {#if sync.kind === "conflict" && sync.conflicts.length}
    <div class="conflicts" data-testid="sync-conflicts">Conflicts: {sync.conflicts.join(", ")}</div>
  {/if}

  <div class="split">
    <section class="left">
      <SessionLauncher {connection} {project} />
    </section>
    <section class="right">
      <AttachPanel projectDir={project.localPath} />
      <ChangesList projectDir={project.localPath} />
      <FlutterPanel projectDir={project.localPath} />
    </section>
  </div>
</div>

<style>
  .ws { display: flex; flex-direction: column; height: 100%; }
  .ws-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .back { background: var(--surface-raised); color: var(--text); padding: 4px 10px; }
  .title { font-weight: 600; }
  .branch { color: var(--text-muted); font-weight: 400; font-size: 12px; margin-left: 6px; }
  .ws-sync { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .ghost { background: transparent; border: 1px solid var(--border); color: var(--text-muted); padding: 2px 8px; font-size: 12px; }
  .conflicts { color: var(--error); padding: 4px 16px; font-size: 12px; border-bottom: 1px solid var(--border); }
  .split { flex: 1; display: flex; min-height: 0; }
  .left { width: 50%; display: flex; flex-direction: column; border-right: 1px solid var(--border); min-height: 0; overflow-y: auto; }
  .right { width: 50%; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
</style>
