<script lang="ts">
  import type { SyncStatus } from "../lib/sync-events";
  let { status }: { status: SyncStatus } = $props();

  const LABELS: Record<string, string> = {
    not_installed: "Sync unavailable",
    no_session: "Not syncing",
    connecting: "Connecting…",
    watching: "⇅ In sync",
    syncing: "⇅ Syncing…",
    paused: "⏸ Paused",
    error: "Sync error",
  };
  let text = $derived(
    status.kind === "conflict"
      ? `⚠ ${status.conflicts.length} conflict${status.conflicts.length === 1 ? "" : "s"}`
      : (LABELS[status.kind] ?? status.kind),
  );
  let cls = $derived(
    status.kind === "watching" ? "ok"
    : status.kind === "syncing" || status.kind === "connecting" ? "warn"
    : status.kind === "conflict" || status.kind === "error" ? "error"
    : "muted",
  );
</script>

<span class="pill {cls}" data-testid="sync-pill">{text}</span>

<style>
  .pill { font-size: 11px; padding: 3px 9px; border-radius: 20px; font-weight: 600; background: var(--surface-raised); }
  .pill.ok { background: var(--accent-bg); color: var(--ok); }
  .pill.warn { color: var(--warn); }
  .pill.error { color: var(--error); }
  .pill.muted { color: var(--text-muted); }
</style>
