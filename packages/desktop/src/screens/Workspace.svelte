<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Project } from "../lib/types";
  import {
    initChatState, startTurn, applyChatEvent, endStream, withAttachments, type ChatState,
  } from "../lib/chat-session";
  import { startChat, cancelChat, applyPatch, onChatEvent, onChatEnd, startSyncWatch, stopSyncWatch, onSyncEvent, syncCommand, pickFile, pushAttachment } from "../lib/ipc";
  import ChatPane from "../components/ChatPane.svelte";
  import ChangesPanel from "../components/ChangesPanel.svelte";
  import SyncPill from "../components/SyncPill.svelte";
  import type { SyncStatus } from "../lib/sync-events";
  import type { UnlistenFn } from "@tauri-apps/api/event";

  let { project, onback }: { project: Project; onback?: () => void } = $props();

  let chat = $state<ChatState>(initChatState(crypto.randomUUID()));
  let applying = $state(false);
  let attachments = $state<{ name: string; remotePath: string }[]>([]);

  function baseName(p: string): string { return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? p; }
  let sync = $state<SyncStatus>({ kind: "no_session", conflicts: [] });
  let unlisten: UnlistenFn | null = null;
  let unlistenEnd: UnlistenFn | null = null;
  let unlistenSync: UnlistenFn | null = null;

  onMount(async () => {
    unlisten = await onChatEvent((ev) => {
      chat = applyChatEvent(chat, ev);
    });
    unlistenEnd = await onChatEnd(() => {
      chat = endStream(chat);
    });
    unlistenSync = await onSyncEvent((l) => {
      if (l.type === "status") sync = l.status;
    });
    try { await startSyncWatch(project.localPath); } catch { /* surfaced via pill */ }
  });
  onDestroy(() => {
    unlisten?.();
    unlistenEnd?.();
    unlistenSync?.();
    stopSyncWatch();
  });

  async function toggleSync() {
    const sub = sync.kind === "paused" ? "resume" : "pause";
    await syncCommand(project.localPath, sub);
    const line = await syncCommand(project.localPath, "status");
    if (line && line.type === "status") sync = line.status;
  }

  async function attachFile() {
    try {
      const f = await pickFile();
      if (!f) return;
      const remotePath = await pushAttachment(project.localPath, f, false);
      attachments = [...attachments, { name: baseName(f), remotePath }];
    } catch (e) {
      chat = applyChatEvent(chat, { type: "error", code: "attach", message: String(e), recoverable: true });
    }
  }

  async function attachClip() {
    try {
      const remotePath = await pushAttachment(project.localPath, undefined, true);
      attachments = [...attachments, { name: "clipboard image", remotePath }];
    } catch (e) {
      chat = applyChatEvent(chat, { type: "error", code: "attach", message: String(e), recoverable: true });
    }
  }

  function removeAttachment(i: number) { attachments = attachments.filter((_, idx) => idx !== i); }

  async function send(text: string) {
    const paths = attachments.map((a) => a.remotePath);
    chat = startTurn(chat, text);          // bubble shows the user's typed text
    const full = withAttachments(text, paths);
    attachments = [];
    try {
      await startChat(project.localPath, chat.sessionUuid, full);
    } catch (e) {
      chat = applyChatEvent(chat, { type: "error", code: "ipc", message: String(e), recoverable: false });
    }
  }

  async function cancel() {
    await cancelChat();
    chat = applyChatEvent(chat, { type: "cancelled" });
  }

  async function apply() {
    if (!chat.diff) return;
    applying = true;
    try {
      const result = await applyPatch(project.localPath, chat.diff.patch);
      if (result.applied) chat = { ...chat, diff: null };
      else chat = applyChatEvent(chat, { type: "error", code: "apply", message: result.error ?? "apply failed", recoverable: true });
    } finally {
      applying = false;
    }
  }

  function reject() {
    chat = { ...chat, diff: null };
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
    <div class="conflicts" data-testid="sync-conflicts">
      Conflicts: {sync.conflicts.join(", ")}
    </div>
  {/if}

  {#if chat.error}
    <div class="error" role="alert" data-testid="ws-error">{chat.error}</div>
  {/if}

  <div class="split">
    <section class="left">
      <ChatPane messages={chat.messages} streaming={chat.streaming} syncing={chat.syncing}
        {attachments} onsend={send} oncancel={cancel}
        onattachfile={attachFile} onattachclip={attachClip} onremoveattachment={removeAttachment} />
    </section>
    <section class="right">
      <ChangesPanel diff={chat.diff} {applying} onapply={apply} onreject={reject} />
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
  .error { color: var(--error); padding: 8px 16px; font-size: 13px; }
  .conflicts { color: var(--error); padding: 4px 16px; font-size: 12px; border-bottom: 1px solid var(--border); }
  .split { flex: 1; display: flex; min-height: 0; }
  .left { width: 50%; display: flex; flex-direction: column; border-right: 1px solid var(--border); min-height: 0; }
  .right { width: 50%; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
</style>
