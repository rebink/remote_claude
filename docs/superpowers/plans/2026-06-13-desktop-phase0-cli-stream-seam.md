# Desktop Phase 0 — CLI provisioning stream seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `patchwire setup --provision-remote` a machine-driven `--stream` mode that emits each orchestrator event as one NDJSON line and gates consent via a stdin line, so the desktop fleet console (GUI-over-CLI) can render live provisioning progress and a user-approved consent step.

**Architecture:** Extend the existing `runProvisionRemote` in `packages/cli/src/commands/setup.ts`. Add a `stream` input flag and an injectable `readConsentLine` dependency. In stream mode, `onEvent` writes `JSON.stringify(event) + "\n"` for every event (`preview`/`phase`/`step`/`rollback`/`done`), the consent gate reads one JSON line (`{"consent":true|false}`) from stdin, and a terminal `{"type":"result",…}` line carries the final `detected`/`plan`/`outcome`/`health` (which the `done` event omits). No orchestrator logic changes; the human (`--json` off) and existing `--json` single-shot paths are untouched.

**Tech Stack:** TypeScript (NodeNext, `.ts` import extensions), Commander CLI, Vitest. No new dependencies.

**Scope note:** This plan covers ONLY the provisioning stream seam — the contract the desktop wizard binds to. `doctor --json` (for the inventory health view) and the Tauri app (Phases 1–3) are deferred to their own plans, written after a short Tauri spike resolves the spec's open questions (sidecar naming, keychain plugin, WebKitGTK).

---

### Task 1: Add `stream` flag + injectable consent reader to `runProvisionRemote`

**Files:**
- Modify: `packages/cli/src/commands/setup.ts` (the `ProvisionRemoteInput` interface ~408–418 and `runProvisionRemote` ~422–487)
- Test: `packages/cli/test/commands/setup-provision-remote.test.ts`

- [ ] **Step 1: Write the failing test — stream emits one NDJSON line per event + a terminal result line**

Add to `packages/cli/test/commands/setup-provision-remote.test.ts` (reuse the file's existing `captureStdout`, `fakeProvision`, `TOKEN` helpers):

```ts
it('stream → emits one NDJSON line per orchestrator event, then a result line', async () => {
  const completedResult = {
    status: 'completed' as const,
    detected: { os: 'linux' },
    plan: { steps: [] },
    outcome: { status: 'completed', degraded: [] },
    health: { tailnet: true, agent: 'healthy' as const },
  };
  const provision = fakeProvision(async (_conn, _opts, deps) => {
    deps.onEvent({ type: 'preview', plan: { steps: [{ id: 'bootstrap-agent' }] }, elevation: [] });
    deps.onEvent({ type: 'step', step: 'bootstrap-agent', status: 'start' });
    deps.onEvent({ type: 'step', step: 'bootstrap-agent', status: 'ok', detail: 'installed' });
    deps.onEvent({ type: 'done', status: 'completed' });
    return completedResult;
  });

  const { runProvisionRemote } = await import('../../src/commands/setup.ts');
  const out = await captureStdout(() =>
    runProvisionRemote(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN, stream: true },
      { provision, readConsentLine: async () => '{"consent":true}' },
    ),
  );

  const lines = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  expect(lines[0]).toMatchObject({ type: 'preview' });
  expect(lines.some((l) => l.type === 'step' && l.status === 'start')).toBe(true);
  expect(lines.find((l) => l.type === 'done')).toMatchObject({ status: 'completed' });
  expect(lines.at(-1)).toMatchObject({ type: 'result', status: 'completed', health: { agent: 'healthy' } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/setup-provision-remote.test.ts -t "emits one NDJSON line"`
Expected: FAIL — `stream`/`readConsentLine` not handled, no per-event or `result` lines on stdout.

- [ ] **Step 3: Add `stream` to the input type**

In `packages/cli/src/commands/setup.ts`, add the field to `ProvisionRemoteInput` (alongside `yes?` / `json?`):

```ts
  yes?: boolean;
  json?: boolean;
  /** Machine event-stream mode: NDJSON events to stdout, consent via a stdin line. */
  stream?: boolean;
```

- [ ] **Step 4: Add the injectable consent reader + default**

In the same file, near the top-level helpers (module scope, before `runProvisionRemote`), add:

```ts
/** Read one line of stdin, resolving '' on timeout/EOF. Injected in tests. */
function defaultReadConsentLine(timeoutMs = 600_000): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    const cleanup = () => {
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.pause();
    };
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) { cleanup(); resolve(buf.slice(0, nl)); }
    };
    const onEnd = () => { cleanup(); resolve(buf); };
    const timer = setTimeout(() => { cleanup(); resolve(''); }, timeoutMs);
    process.stdin.resume();
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
  });
}
```

- [ ] **Step 5: Extend the `deps` parameter type**

Change the `runProvisionRemote` signature's `deps` to add the reader:

```ts
export async function runProvisionRemote(
  input: ProvisionRemoteInput,
  deps: { provision?: ProvisionFn; readConsentLine?: () => Promise<string> } = {},
): Promise<void> {
```

- [ ] **Step 6: Implement stream behaviour (consent, onEvent, terminal result line)**

In `runProvisionRemote`, after `const provision = deps.provision ?? provisionRemote;`, add:

```ts
  const stream = !!input.stream;
  const readConsentLine = deps.readConsentLine ?? defaultReadConsentLine;
```

Replace the existing `confirm` with a stream-aware version (keep the existing prompt branch for human mode):

```ts
  const confirm = async (plan: ProvisionPlan, elevation: ProvisionStep[]): Promise<boolean> => {
    if (input.yes) return true;
    if (stream) {
      try { return !!(JSON.parse(await readConsentLine()) as { consent?: boolean }).consent; }
      catch { return false; }
    }
    if (input.json || !process.stdout.isTTY) return false; // cannot prompt
    const { proceed } = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: `Provision ${input.user}@${input.host} — ${plan.steps.length} steps${elevation.length ? `, ${elevation.length} need elevation` : ''}. Proceed?`,
      initial: false,
    });
    return !!proceed;
  };
```

Change the `human` guard and `onEvent` so stream mode prints NDJSON:

```ts
  const human = !input.json && !stream;
  const onEvent = (e: ProvisionEvent | PreviewEvent) => {
    if (stream) { process.stdout.write(JSON.stringify(e) + '\n'); return; }
    if (!human) return;
    if (e.type === 'preview') {
      log.info(`Plan (${e.plan.steps.length} steps): ${e.plan.steps.map((s) => s.id).join(', ')}`);
      if (e.elevation.length) log.warn(`${e.elevation.length} steps need elevation: ${e.elevation.map((s) => s.id).join(', ')}`);
    } else if (e.type === 'step') {
      if (e.status === 'start') log.info(`  ▶ ${e.step} …`);
      else if (e.status === 'ok') log.info(`  ✓ ${e.step}${e.detail ? ` — ${e.detail}` : ''}`);
      else if (e.status === 'degraded') log.warn(`  ⚠ ${e.step} — ${e.detail ?? 'degraded'}`);
      else if (e.status === 'failed') log.err(`  ✗ ${e.step} — ${e.detail ?? 'failed'}`);
    } else if (e.type === 'rollback') {
      log.warn(`  ↩ rolling back ${e.step}`);
    }
  };
```

After `const result: ProvisionRemoteResult = await provision(...)`, add the stream terminal line BEFORE the existing `if (input.json)` block:

```ts
  if (stream) {
    process.stdout.write(JSON.stringify({
      type: 'result',
      status: result.status,
      detected: result.detected,
      plan: result.plan,
      outcome: result.outcome,
      health: result.health,
    }) + '\n');
    return;
  }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/setup-provision-remote.test.ts -t "emits one NDJSON line"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/setup.ts packages/cli/test/commands/setup-provision-remote.test.ts
git commit -m "feat(cli): --provision-remote --stream emits NDJSON events + terminal result line"
```

---

### Task 2: Consent gate reads `{"consent":…}` from the injected reader

**Files:**
- Test: `packages/cli/test/commands/setup-provision-remote.test.ts`
- (Implementation already added in Task 1, Step 6 — these tests lock the behaviour.)

- [ ] **Step 1: Write the failing tests — consent true / false / malformed**

```ts
it.each([
  ['{"consent":true}', true],
  ['{"consent":false}', false],
  ['not json', false],
  ['', false],
])('stream → consent line %j gates execution to %s', async (line, expected) => {
  let confirmed: boolean | undefined;
  const provision = fakeProvision(async (_conn, _opts, deps) => {
    confirmed = await deps.confirm({ steps: [] }, []);
    return { status: confirmed ? 'completed' : 'cancelled', detected: {}, plan: { steps: [] }, outcome: { status: 'completed', degraded: [] } };
  });
  const { runProvisionRemote } = await import('../../src/commands/setup.ts');
  await captureStdout(() =>
    runProvisionRemote(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN, stream: true },
      { provision, readConsentLine: async () => line },
    ),
  );
  expect(confirmed).toBe(expected);
});
```

- [ ] **Step 2: Run to verify**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/setup-provision-remote.test.ts -t "consent line"`
Expected: PASS (implementation from Task 1 already covers these). If any case fails, fix the `confirm` parsing in setup.ts and re-run.

- [ ] **Step 3: Verify `--yes` still short-circuits consent in stream mode**

```ts
it('stream + yes → consent auto-approved without reading stdin', async () => {
  let readCalled = false;
  let confirmed: boolean | undefined;
  const provision = fakeProvision(async (_conn, _opts, deps) => {
    confirmed = await deps.confirm({ steps: [] }, []);
    return { status: 'completed', detected: {}, plan: { steps: [] }, outcome: { status: 'completed', degraded: [] } };
  });
  const { runProvisionRemote } = await import('../../src/commands/setup.ts');
  await captureStdout(() =>
    runProvisionRemote(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN, stream: true, yes: true },
      { provision, readConsentLine: async () => { readCalled = true; return '{"consent":false}'; } },
    ),
  );
  expect(confirmed).toBe(true);
  expect(readCalled).toBe(false);
});
```

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/setup-provision-remote.test.ts -t "consent auto-approved"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/test/commands/setup-provision-remote.test.ts
git commit -m "test(cli): lock --stream consent gate (true/false/malformed/yes-shortcut)"
```

---

### Task 3: Regression — existing `--json` single-shot path is unchanged

**Files:**
- Test: `packages/cli/test/commands/setup-provision-remote.test.ts`

- [ ] **Step 1: Write the test — `--json` (no stream) still emits exactly one final blob, no per-event lines**

```ts
it('json (no stream) → single final blob, no per-event NDJSON lines', async () => {
  const provision = fakeProvision(async (_conn, _opts, deps) => {
    deps.onEvent({ type: 'step', step: 'bootstrap-agent', status: 'start' }); // must be suppressed in json mode
    return { status: 'completed', detected: { os: 'linux' }, plan: { steps: [] }, outcome: { status: 'completed', degraded: [] }, health: { tailnet: true, agent: 'healthy' } };
  });
  const { runProvisionRemote } = await import('../../src/commands/setup.ts');
  const out = await captureStdout(() =>
    runProvisionRemote(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN, json: true, yes: true },
      { provision },
    ),
  );
  const lines = out.trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toMatchObject({ status: 'completed', health: { agent: 'healthy' } });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/setup-provision-remote.test.ts -t "single final blob"`
Expected: PASS (the `human`/`stream` guards keep `--json` behaviour intact).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/test/commands/setup-provision-remote.test.ts
git commit -m "test(cli): guard --json single-shot path against stream regression"
```

---

### Task 4: Wire the `--stream` flag into the Commander CLI

**Files:**
- Modify: `packages/cli/src/cli.ts` (the `setup` command options ~32–37 and the `runProvisionRemote({…})` call ~67–68)

- [ ] **Step 1: Add the option**

In `packages/cli/src/cli.ts`, alongside the existing `--provision-remote` / `--yes` options on the `setup` command, add:

```ts
  .option('--stream', 'emit NDJSON provisioning events + read {"consent":…} from stdin (for the desktop console)')
```

- [ ] **Step 2: Pass it through to `runProvisionRemote`**

In the `--provision-remote` action that calls `runProvisionRemote({ … })`, add `stream: opts.stream,` to the argument object (next to `yes: opts.yes` / `json: opts.json`). Ensure the local `opts` type includes `stream?: boolean`.

- [ ] **Step 3: Typecheck**

Run: `cd packages/cli && node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke (optional, against localhost like the validation harness)**

```bash
cd packages/cli
printf '{"consent":false}\n' | node dist/cli.js setup --provision-remote --stream \
  --host 127.0.0.1 --user "$USER" --ssh-port 22 2>/dev/null | head
```
Expected: NDJSON lines — a `preview` line, then a `result` line with `status:"cancelled"` (consent was false). No mutation.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cli.ts
git commit -m "feat(cli): expose setup --provision-remote --stream flag"
```

---

### Task 5: Full suite + typecheck green

- [ ] **Step 1: Run the full CLI suite**

Run: `cd packages/cli && node_modules/.bin/vitest run && node_modules/.bin/tsc --noEmit`
Expected: all tests pass (including the prior provisioning suites), tsc clean.

- [ ] **Step 2: Commit any final touch-ups**

```bash
git add -A
git commit -m "chore(cli): phase 0 stream seam — suite green" || echo "nothing to commit"
```

---

## Deferred to later plans (not this one)

- **`doctor --json`** — structured health for the inventory view. Lands with the inventory phase (it's consumed there, not by the wizard).
- **Consent timeout policy** — the default reader uses a 10-minute timeout → `''` → consent false. Revisit if the GUI needs a different default.
- **Tauri app (Phases 1–3)** — own plan after a Tauri spike resolves: sidecar binary naming (bun targets → Tauri target-triple), OS-keychain plugin coverage, WebKitGTK behaviour on Linux.

## Self-review notes

- **Spec coverage:** implements §2 of the design (the CLI event-stream seam: NDJSON events + stdin consent). `doctor --json` from §2 is explicitly deferred to the inventory phase (where it is consumed) — noted above, not dropped.
- **Type consistency:** `stream` (input), `readConsentLine` (dep), and the terminal `{type:'result',…}` line are used identically across Tasks 1–4. Event shapes match `ProvisionEvent | PreviewEvent` from `provision/types.ts` and `provision-remote.ts`.
- **No placeholders:** every code step shows complete code; every run step shows the command + expected result.
