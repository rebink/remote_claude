<script lang="ts">
  import { isSafeToken, defaultRemotePath, sshCopyIdCommand, genToken, wizardCanProvision } from "../lib/wizard";
  import { ensureSshKey, verifyKey, openTerminal } from "../lib/ipc";

  let { localPath, onfinish, onback }: { localPath: string; onfinish?: () => void; onback?: () => void } = $props();

  let step = $state(1);
  let host = $state("");
  let user = $state("");
  let sshPort = $state(22);
  let agentPort = $state(7878);
  let project = $state("");
  let remotePath = $state("");
  let pubKeyPath = $state("");
  let keyVerified = $state(false);
  let verifyError = $state("");

  let keyPath = $derived(`~/.patchwire/keys/${host}-${user}`);
  let copyCmd = $derived(pubKeyPath ? sshCopyIdCommand(pubKeyPath, user, host, sshPort) : "");
  let step1Valid = $derived(isSafeToken(host) && isSafeToken(user) && project.trim() !== "");

  async function toStep2() {
    if (!remotePath) remotePath = defaultRemotePath(project);
    pubKeyPath = await ensureSshKey(host, user);
    step = 2;
  }

  async function verify() {
    verifyError = "";
    keyVerified = await verifyKey({ host, user, sshPort, keyPath });
    if (!keyVerified) verifyError = "Key not working yet — run the command in Terminal, then retry.";
  }

  // Task 5 adds provision() for Step 4.
</script>

<div class="wiz" data-testid="setup-wizard">
  <header>
    <button class="back" onclick={() => onback?.()}>←</button>
    <span>Set up — {localPath}</span>
  </header>

  {#if step === 1}
    <h3>1 · Machine</h3>
    <label>Host<input aria-label="Host" bind:value={host} /></label>
    <label>User<input aria-label="User" bind:value={user} /></label>
    <label>Project name<input aria-label="Project name" bind:value={project} /></label>
    <label>Remote path<input aria-label="Remote path" bind:value={remotePath} placeholder={defaultRemotePath(project || "project")} /></label>
    <div class="ports">
      <label>SSH port<input aria-label="SSH port" type="number" bind:value={sshPort} /></label>
      <label>Agent port<input aria-label="Agent port" type="number" bind:value={agentPort} /></label>
    </div>
    <button class="primary" data-testid="wiz-next" disabled={!step1Valid} onclick={toStep2}>Next</button>
  {:else if step === 2}
    <h3>2 · SSH key</h3>
    <p>Run this once in your terminal (you'll type the SSH password):</p>
    <code class="cmd mono" data-testid="copy-command">{copyCmd}</code>
    <div class="row">
      <button class="ghost" onclick={() => navigator.clipboard?.writeText(copyCmd)}>Copy</button>
      <button class="ghost" data-testid="open-terminal" onclick={() => openTerminal(copyCmd)}>Open Terminal</button>
      <button class="ghost" data-testid="verify-key" onclick={verify}>I've installed the key — Verify</button>
    </div>
    {#if verifyError}<div class="error" data-testid="verify-error">{verifyError}</div>{/if}
    {#if keyVerified}<div class="ok" data-testid="key-ok">Key verified ✓</div>{/if}
    <button class="primary" data-testid="wiz-next" disabled={!keyVerified} onclick={() => (step = 3)}>Next</button>
  {:else if step === 3}
    <h3>3 · Review</h3>
    <ul class="review">
      <li>Project: <b>{project}</b></li>
      <li class="mono">{localPath} ⇄ {remotePath}</li>
      <li class="mono">{user}@{host}:{sshPort}</li>
    </ul>
    <button class="primary" data-testid="wiz-next" onclick={() => (step = 4)}>Provision</button>
  {:else}
    <!-- Task 5: Step 4 provision UI -->
  {/if}
</div>

<style>
  .wiz { max-width: 480px; margin: 32px auto; display: flex; flex-direction: column; gap: 10px; padding: 0 20px; }
  header { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 12px; }
  .back { background: var(--surface-raised); color: var(--text); padding: 3px 9px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-muted); }
  label input { color: var(--text); }
  .ports { display: flex; gap: 12px; }
  .ports label { flex: 1; }
  .cmd { display: block; padding: 10px; background: var(--surface-base); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 11px; overflow-x: auto; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 7px 12px; font-size: 12px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 9px; font-weight: 600; }
  .primary:disabled { opacity: .5; cursor: not-allowed; }
  .error { color: var(--error); font-size: 12px; }
  .ok { color: var(--ok); font-size: 12px; }
  .review { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
</style>
