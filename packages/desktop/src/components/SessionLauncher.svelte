<script lang="ts">
  import type { Connection, Project } from "../lib/types";
  import { buildLaunchCommand } from "../lib/session";
  import { openTerminal } from "../lib/ipc";

  let { connection, project }: { connection: Connection | undefined; project: Project } = $props();
  let skipPerms = $state(false);
  let error = $state("");

  async function open() {
    if (!connection) return;
    error = "";
    try {
      await openTerminal(buildLaunchCommand(connection, project, skipPerms));
    } catch (e) {
      error = `Could not open terminal: ${e}`;
    }
  }
</script>

<div class="launcher">
  <h2>Claude session</h2>
  <p class="hint">
    Opens your terminal and runs <code>claude</code> on the remote against this project.
    Edits sync back automatically — review them under “Changes”.
  </p>
  {#if !connection}
    <p class="warn" data-testid="no-conn">No connection found for this project.</p>
  {/if}
  <label class="skip"><input type="checkbox" data-testid="skip-perms" bind:checked={skipPerms} /> Skip permission prompts (<code>--dangerously-skip-permissions</code>)</label>
  <button class="primary" data-testid="open-session" disabled={!connection} onclick={open}>Open claude session</button>
  {#if error}<p class="err" data-testid="launch-error">{error}</p>{/if}
</div>

<style>
  .launcher { padding: 24px; display: flex; flex-direction: column; gap: 14px; max-width: 460px; margin: 0 auto; }
  h2 { font-size: 16px; }
  .hint { color: var(--text-muted); font-size: 13px; line-height: 1.5; }
  .skip { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); }
  .primary { background: var(--accent-strong); color: #fff; padding: 10px; font-weight: 600; align-self: flex-start; }
  .primary:disabled { opacity: .5; cursor: not-allowed; }
  .warn { color: var(--warn); font-size: 12px; }
  .err { color: var(--error); font-size: 12px; }
  code { background: var(--surface-base); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 1px 5px; }
</style>
