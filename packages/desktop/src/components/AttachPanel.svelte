<script lang="ts">
  import { pickFile, pushAttachment, copyToClipboard } from "../lib/ipc";

  let { projectDir }: { projectDir: string } = $props();
  let items = $state<{ name: string; remotePath: string }[]>([]);
  let note = $state("");
  let error = $state("");

  function baseName(p: string): string { return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? p; }

  async function stage(remotePath: string, name: string) {
    items = [...items, { name, remotePath }];
    await copyToClipboard(remotePath);
    note = `Copied remote path: ${remotePath}`;
  }

  async function attachFile() {
    error = "";
    try {
      const f = await pickFile();
      if (!f) return;
      const rp = await pushAttachment(projectDir, f, false);
      await stage(rp, baseName(f));
    } catch (e) { error = `Attach failed: ${e}`; }
  }
  async function attachClip() {
    error = "";
    try {
      const rp = await pushAttachment(projectDir, undefined, true);
      await stage(rp, "clipboard image");
    } catch (e) { error = `Attach failed: ${e}`; }
  }
</script>

<div class="attach">
  <div class="row">
    <strong>Attachments</strong>
    <button class="ghost" data-testid="attach-file" onclick={attachFile}>📎 File</button>
    <button class="ghost" data-testid="attach-clip" onclick={attachClip}>📷 Clipboard</button>
  </div>
  {#if note}<div class="note" data-testid="attach-note">{note}</div>{/if}
  {#if error}<div class="err" data-testid="attach-error">{error}</div>{/if}
  <ul class="list" data-testid="attach-list">
    {#each items as it (it.remotePath)}<li><code>{it.name}</code></li>{/each}
  </ul>
</div>

<style>
  .attach { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--border); }
  .row { display: flex; align-items: center; gap: 8px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 5px 10px; font-size: 12px; }
  .note { color: var(--text-muted); font-size: 11px; }
  .err { color: var(--error); font-size: 12px; }
  .list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; margin: 0; padding: 0; list-style: none; }
  code { background: var(--surface-base); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 1px 5px; }
</style>
