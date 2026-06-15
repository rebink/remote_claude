<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Project } from "../lib/types";
  import {
    initChatState, startTurn, applyChatEvent, endStream, type ChatState,
  } from "../lib/chat-session";
  import { startChat, cancelChat, applyPatch, onChatEvent, onChatEnd } from "../lib/ipc";
  import ChatPane from "../components/ChatPane.svelte";
  import ChangesPanel from "../components/ChangesPanel.svelte";
  import type { UnlistenFn } from "@tauri-apps/api/event";

  let { project, onback }: { project: Project; onback?: () => void } = $props();

  let chat = $state<ChatState>(initChatState(crypto.randomUUID()));
  let applying = $state(false);
  let unlisten: UnlistenFn | null = null;
  let unlistenEnd: UnlistenFn | null = null;

  onMount(async () => {
    unlisten = await onChatEvent((ev) => {
      chat = applyChatEvent(chat, ev);
    });
    unlistenEnd = await onChatEnd(() => {
      chat = endStream(chat);
    });
  });
  onDestroy(() => {
    unlisten?.();
    unlistenEnd?.();
  });

  async function send(text: string) {
    chat = startTurn(chat, text);
    try {
      await startChat(project.localPath, chat.sessionUuid, text);
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
  </header>

  {#if chat.error}
    <div class="error" role="alert" data-testid="ws-error">{chat.error}</div>
  {/if}

  <div class="split">
    <section class="left">
      <ChatPane messages={chat.messages} streaming={chat.streaming} syncing={chat.syncing} onsend={send} oncancel={cancel} />
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
  .error { color: var(--error); padding: 8px 16px; font-size: 13px; }
  .split { flex: 1; display: flex; min-height: 0; }
  .left { width: 50%; display: flex; flex-direction: column; border-right: 1px solid var(--border); min-height: 0; }
  .right { width: 50%; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
</style>
