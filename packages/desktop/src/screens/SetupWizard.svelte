<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { isSafeToken, sshCopyIdCommand, genToken, wizardCanProvision } from "../lib/wizard";
  import { ensureSshKey, verifyKey, openTerminal, startProvision, sendConsent, onProvEvent, saveConnection } from "../lib/ipc";
  import { initialState, reduce, type ProvisionUiState } from "../provision-state";
  import { buildConnection } from "../lib/model";
  import type { Connection } from "../lib/types";
  import type { UnlistenFn } from "@tauri-apps/api/event";

  let { onfinish, onback }: { onfinish?: (c: Connection) => void; onback?: () => void } = $props();

  let step = $state(1);
  let name = $state("");
  let host = $state("");
  let user = $state("");
  let sshPort = $state(22);
  let agentPort = $state(7878);
  let pubKeyPath = $state("");
  let keyVerified = $state(false);
  let verifyError = $state("");
  let token = $state("");

  let prov = $state<ProvisionUiState>(initialState());
  let unlistenProv: UnlistenFn | null = null;
  let saved = $state(false);

  let keyPath = $derived(`~/.patchwire/keys/${host}-${user}`);
  let copyCmd = $derived(pubKeyPath ? sshCopyIdCommand(pubKeyPath, user, host, sshPort) : "");
  let step1Valid = $derived(name.trim() !== "" && isSafeToken(host) && isSafeToken(user));

  async function toStep2() {
    pubKeyPath = await ensureSshKey(host, user);
    step = 2;
  }

  async function verify() {
    verifyError = "";
    keyVerified = await verifyKey({ host, user, sshPort, keyPath });
    if (!keyVerified) verifyError = "Key not working yet — run the command in Terminal, then retry.";
  }

  onMount(async () => {
    unlistenProv = await onProvEvent((line) => {
      prov = reduce(prov, line);
      if (!saved && prov.phase === "done" && prov.result?.status === "completed") {
        saved = true;
        const c = buildConnection({ name, host, user, sshPort, keyPath, agentPort, token, agentVersion: undefined });
        saveConnection(c).then(() => onfinish?.(c));
      }
    });
  });

  onDestroy(() => unlistenProv?.());

  async function provision() {
    prov = initialState();
    saved = false;
    token = genToken();
    await startProvision({ host, user, port: sshPort, keyPath, agentPort, token });
  }
</script>

<div class="wiz" data-testid="setup-wizard">
  <header>
    <button class="back" onclick={() => onback?.()}>←</button>
    <span>Add connection</span>
  </header>

  {#if step === 1}
    <h3>1 · Machine</h3>
    <label>Connection name<input aria-label="Connection name" bind:value={name} /></label>
    <label>Host<input aria-label="Host" bind:value={host} /></label>
    <label>User<input aria-label="User" bind:value={user} /></label>
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
      <li>Connection: <b>{name}</b></li>
      <li class="mono">{user}@{host}:{sshPort}</li>
    </ul>
    <button class="primary" data-testid="wiz-next" onclick={() => { step = 4; provision(); }}>Provision</button>
  {:else}
    <h3>4 · Provision</h3>
    <ul class="steps" data-testid="prov-steps">
      {#each prov.steps as s (s.id)}
        {@const st = prov.stepStatus[s.id]}
        <li>
          {st?.status === "ok" ? "✓" : st?.status === "failed" ? "✗" : st?.status === "degraded" ? "⚠" : "…"} {s.id}
          {#if (st?.status === "failed" || st?.status === "degraded") && st?.detail}
            <span class="step-detail error" data-testid="prov-detail">{st.detail}</span>
          {/if}
        </li>
      {/each}
    </ul>
    {#if prov.awaitingConsent}
      <p>Review the plan above. Proceed?</p>
      <button class="primary" data-testid="prov-confirm" onclick={() => sendConsent(true)}>Confirm & provision</button>
    {/if}
    {#if prov.phase === "done"}
      <div class={prov.result?.status === "completed" ? "ok" : "error"} data-testid="prov-result">
        {prov.result?.status === "completed" ? "Provisioned ✓ — finishing…" : `Failed: ${prov.result?.failedStep ?? "unknown"}`}
      </div>
      {#if prov.result?.status !== "completed" && prov.result?.failedStep && prov.stepStatus[prov.result.failedStep]?.detail}
        <div class="error" data-testid="prov-detail">{prov.stepStatus[prov.result.failedStep]?.detail}</div>
      {/if}
    {/if}
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
  .steps { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-family: monospace; }
  .step-detail { display: block; padding-left: 1.2em; font-size: 11px; }
</style>
