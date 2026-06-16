<script lang="ts">
  import type { ChatMessage } from "../lib/chat-session";

  let {
    messages,
    streaming,
    syncing,
    onsend,
    oncancel,
    attachments = [],
    onattachfile,
    onattachclip,
    onremoveattachment,
  }: {
    messages: ChatMessage[];
    streaming: boolean;
    syncing: boolean;
    onsend?: (text: string) => void;
    oncancel?: () => void;
    attachments?: { name: string }[];
    onattachfile?: () => void;
    onattachclip?: () => void;
    onremoveattachment?: (i: number) => void;
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

{#if attachments.length}
  <div class="chips" data-testid="attach-chips">
    {#each attachments as a, i (i)}
      <span class="chip" data-testid="attach-chip">📎 {a.name}<button class="chip-x" data-testid="chip-remove-{i}" onclick={() => onremoveattachment?.(i)}>✕</button></span>
    {/each}
  </div>
{/if}

<div class="composer-bar">
  <textarea
    class="composer"
    data-testid="composer"
    bind:value={draft}
    placeholder="Ask Claude to change something…"
    rows="2"
  ></textarea>
  <button class="attach" data-testid="attach-file" title="Attach file" onclick={() => onattachfile?.()}>📎</button>
  <button class="attach" data-testid="attach-clip" title="Attach clipboard image" onclick={() => onattachclip?.()}>📷</button>
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
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 14px 0; }
  .chip { display: inline-flex; align-items: center; gap: 6px; background: var(--surface-raised); border: 1px solid var(--border); border-radius: 20px; padding: 3px 10px; font-size: 11px; }
  .chip-x { background: transparent; color: var(--text-muted); padding: 0 2px; }
  .attach { background: var(--surface-raised); color: var(--text); padding: 8px 10px; }
</style>
