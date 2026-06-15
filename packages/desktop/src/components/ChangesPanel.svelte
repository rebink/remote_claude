<script lang="ts">
  import type { PendingDiff } from "../lib/chat-session";

  let {
    diff,
    applying = false,
    onapply,
    onreject,
  }: {
    diff: PendingDiff | null;
    applying?: boolean;
    onapply?: () => void;
    onreject?: () => void;
  } = $props();
</script>

{#if diff}
  <div class="head">
    <span class="summary" data-testid="changes-summary">
      {diff.files.length} file{diff.files.length === 1 ? "" : "s"}
    </span>
    <span class="actions">
      <button class="ghost" data-testid="reject-btn" disabled={applying} onclick={() => onreject?.()}>Reject</button>
      <button class="primary" data-testid="apply-btn" disabled={applying} onclick={() => onapply?.()}>
        {applying ? "Applying…" : "Apply"}
      </button>
    </span>
  </div>

  <div class="files">
    {#each diff.files as f (f.path)}
      <div class="file" data-testid="file-{f.path}">
        <span class="path mono">{f.path}</span>
        <span class="counts"><span class="add">+{f.additions}</span> <span class="del">−{f.deletions}</span></span>
      </div>
    {/each}
  </div>

  <pre class="patch mono" data-testid="patch-text">{diff.patch}</pre>
{:else}
  <div class="empty" data-testid="changes-empty">
    <p>No changes yet</p>
    <p class="sub">Ask Claude to make a change; the diff shows up here for review.</p>
  </div>
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .summary { font-size: 12px; color: var(--text-muted); }
  .actions { display: flex; gap: 8px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 6px 12px; font-size: 12px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 6px 12px; font-size: 12px; font-weight: 600; }
  .primary:disabled, .ghost:disabled { opacity: 0.5; cursor: not-allowed; }
  .files { padding: 8px 16px; }
  .file { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; font-size: 12px; }
  .counts .add { color: var(--ok); }
  .counts .del { color: var(--error); }
  .patch { margin: 0 16px 16px; padding: 10px 12px; background: var(--surface-base); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 11px; overflow: auto; max-height: 40vh; white-space: pre; }
  .empty { text-align: center; color: var(--text-muted); padding: 48px 20px; }
  .empty .sub { font-size: 12px; }
</style>
