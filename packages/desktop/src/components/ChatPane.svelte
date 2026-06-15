<script lang="ts">
  import type { ChatMessage } from "../lib/chat-session";

  let {
    messages,
    streaming,
    syncing,
    onsend,
    oncancel,
  }: {
    messages: ChatMessage[];
    streaming: boolean;
    syncing: boolean;
    onsend?: (text: string) => void;
    oncancel?: () => void;
  } = $props();

  let draft = $state("");

  function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    onsend?.(text);
    draft = "";
  }
</script>

<div class="messages" data-testid="messages">
  {#each messages as m, i (i)}
    <div class="bubble {m.role}" data-testid="bubble">{m.text}</div>
  {/each}
  {#if syncing}
    <div class="sync" data-testid="sync-indicator">⇅ Syncing…</div>
  {/if}
</div>

<div class="composer-bar">
  <textarea
    class="composer"
    data-testid="composer"
    bind:value={draft}
    placeholder="Ask Claude to change something…"
    rows="2"
  ></textarea>
  {#if streaming}
    <button class="stop" data-testid="stop-btn" onclick={() => oncancel?.()}>Stop</button>
  {/if}
  <button class="send" data-testid="send-btn" disabled={streaming || draft.trim() === ""} onclick={send}>Send</button>
</div>

<style>
  .messages { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
  .bubble { padding: 8px 11px; border-radius: 10px; max-width: 80%; line-height: 1.45; font-size: 13px; white-space: pre-wrap; }
  .bubble.user { background: var(--accent-bg); align-self: flex-end; }
  .bubble.assistant { background: var(--surface-raised); border: 1px solid var(--border); align-self: flex-start; }
  .sync { font-size: 11px; color: var(--warn); align-self: flex-start; }
  .composer-bar { display: flex; gap: 8px; align-items: flex-end; padding: 10px 14px; border-top: 1px solid var(--border); }
  .composer { flex: 1; resize: none; }
  .send { background: var(--accent-strong); color: #fff; padding: 8px 14px; font-weight: 600; }
  .send:disabled { opacity: 0.5; cursor: not-allowed; }
  .stop { background: var(--surface-raised); color: var(--text); padding: 8px 14px; }
</style>
