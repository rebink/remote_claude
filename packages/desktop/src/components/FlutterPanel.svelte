<script lang="ts">
  import { reduceAttach, initialAttach, type AttachState } from "../lib/flutter-attach";
  import { detectVmUri, startFlutterAttach, stopFlutterAttach, onFlutterVmClosed } from "../lib/ipc";
  import { onMount } from "svelte";

  let { projectDir }: { projectDir: string } = $props();
  let vmUri = $state("");
  let attachState = $state<AttachState>(initialAttach);

  onMount(() => {
    let un: (() => void) | undefined;
    onFlutterVmClosed(() => { attachState = reduceAttach(attachState, { type: "vm_closed" }); }).then((u) => (un = u));
    return () => un?.();
  });

  async function detect() {
    const u = await detectVmUri();
    if (u) vmUri = u;
  }
  async function attach() {
    attachState = reduceAttach(attachState, { type: "attach_requested" });
    try {
      const target = await startFlutterAttach(projectDir, vmUri);
      attachState = reduceAttach(attachState, { type: "attached", target });
    } catch (e) {
      attachState = reduceAttach(attachState, { type: "error", message: (e as Error).message ?? String(e) });
    }
  }
  async function detach() {
    await stopFlutterAttach(projectDir);
    attachState = reduceAttach(attachState, { type: "detach_requested" });
  }
</script>

<div class="flutter-panel">
  <header>
    <span class="pill pill-{attachState.kind}">{attachState.kind}</span>
    {#if attachState.kind === "attached"}
      <span class="target">{attachState.target}{attachState.capabilities.screenshot ? "" : " · screenshot N/A"}</span>
    {/if}
    {#if attachState.kind === "error"}<span class="err">{attachState.message}</span>{/if}
  </header>

  {#if attachState.kind === "attached"}
    <button onclick={detach}>Detach</button>
  {:else}
    <input placeholder="Dart VM Service URI (http://127.0.0.1:…/token=/)" bind:value={vmUri} />
    <button onclick={detect}>Detect</button>
    <button onclick={attach} disabled={!vmUri || attachState.kind === "attaching"}>Attach</button>
  {/if}
</div>

<style>
  .flutter-panel { display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
  header { display: flex; align-items: center; gap: 8px; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 20px; border: 1px solid var(--border); text-transform: capitalize; }
  .pill-attached { background: var(--accent-bg); }
  .pill-error { color: var(--error); }
  .target { font-size: 11px; color: var(--text-muted); }
  .err { font-size: 11px; color: var(--error); }
  input { flex: 1; }
  button { background: var(--surface-raised); color: var(--text); padding: 6px 12px; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
