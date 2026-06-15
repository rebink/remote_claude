<script lang="ts">
  import type { Project } from "../lib/types";
  import { projectStatusLabel } from "../lib/model";

  let { project, onopen }: { project: Project; onopen?: (p: Project) => void } = $props();
  let label = $derived(projectStatusLabel(project.lastStatus));
  let initials = $derived(
    project.name.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "··",
  );
</script>

<div class="row" data-testid="row" role="button" tabindex="0"
  onclick={() => onopen?.(project)}
  onkeydown={(e) => e.key === "Enter" && onopen?.(project)}>
  <div class="ic">{initials}</div>
  <div class="body">
    <div class="title">
      <span class="name" data-testid="row-name">{project.name}</span>
      <span class="branch" data-testid="row-branch">{project.branch}</span>
    </div>
    {#if project.host || project.user}<div class="remote" data-testid="row-remote">{project.user}@{project.host}</div>{/if}
    <div class="path mono" data-testid="row-path">{project.localPath} ⇄ {project.remotePath}</div>
  </div>
  <span class="pill {label.kind}" data-testid="row-status">{label.text}</span>
</div>

<style>
  .row { display: flex; align-items: center; gap: 14px; padding: 14px 20px;
    border-top: 1px solid var(--border); cursor: pointer; }
  .row:hover { background: var(--surface-raised); }
  .ic { width: 38px; height: 38px; border-radius: 10px; background: var(--accent-bg);
    color: var(--accent); display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 13px; }
  .title { display: flex; align-items: baseline; gap: 8px; }
  .name { font-weight: 600; }
  .branch { font-size: 11px; color: var(--text-muted); background: var(--surface-raised);
    border-radius: 4px; padding: 1px 5px; }
  .body { flex: 1; min-width: 0; }
  .remote { color: var(--text-muted); font-size: 11px; }
  .path { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  .pill { font-size: 11px; padding: 3px 8px; border-radius: 99px;
    font-weight: 600; background: var(--surface-raised); }
  .pill.ok { background: var(--accent-bg); color: var(--ok); }
  .pill.warn { color: var(--warn); }
  .pill.error { color: var(--error); }
  .pill.muted { color: var(--text-muted); }
</style>
