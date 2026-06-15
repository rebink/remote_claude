<script lang="ts">
  import type { Connection } from "../lib/types";
  import { isConnectionComplete } from "../lib/model";
  import { checkHealth, saveConnection } from "../lib/ipc";

  let { onconnected }: { onconnected?: (c: Connection) => void } = $props();

  let host = $state("");
  let user = $state("");
  let keyPath = $state("");
  let sshPort = $state(22);
  let agentPort = $state(7878);
  let busy = $state(false);
  let error = $state("");

  let draft = $derived<Connection>({ host, user, keyPath, sshPort, agentPort });
  let complete = $derived(isConnectionComplete(draft));

  async function connect() {
    error = "";
    busy = true;
    try {
      const health = await checkHealth(draft);
      if (!health.ok) {
        error = "Could not reach the agent. Check host, key, and that the agent is running.";
        return;
      }
      const conn: Connection = { ...draft, agentVersion: health.version };
      await saveConnection(conn);
      onconnected?.(conn);
    } catch (e) {
      error = `Connection failed: ${e}`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="screen">
  <h1>Connect your remote</h1>
  <p class="sub">Point Patchwire at a machine already running the agent.</p>

  <label>Host<input aria-label="Host" bind:value={host} placeholder="studio-mini" /></label>
  <label>User<input aria-label="User" bind:value={user} placeholder="rebin" /></label>
  <label>SSH key path<input aria-label="SSH key path" bind:value={keyPath} placeholder="~/.ssh/id_ed25519" /></label>
  <div class="ports">
    <label>SSH port<input aria-label="SSH port" type="number" bind:value={sshPort} /></label>
    <label>Agent port<input aria-label="Agent port" type="number" bind:value={agentPort} /></label>
  </div>

  {#if error}<div class="error" data-testid="connect-error">{error}</div>{/if}

  <button class="primary" data-testid="connect-btn" disabled={!complete || busy} onclick={connect}>
    {busy ? "Connecting…" : "Connect"}
  </button>
</div>

<style>
  .screen { max-width: 440px; margin: 48px auto; padding: 0 24px;
    display: flex; flex-direction: column; gap: 12px; }
  h1 { font-size: 22px; margin: 0; }
  .sub { color: var(--text-muted); margin: 0 0 8px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-muted); }
  label input { color: var(--text); }
  .ports { display: flex; gap: 12px; }
  .ports label { flex: 1; }
  .error { color: var(--error); font-size: 13px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 10px; font-weight: 600;
    margin-top: 8px; }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
