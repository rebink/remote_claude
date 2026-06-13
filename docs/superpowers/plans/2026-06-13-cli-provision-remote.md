# CLI entry → provisionRemote orchestrator

**Status:** in progress (2026-06-13)

**Goal:** Add a CLI entry that drives the `provisionRemote` orchestrator end-to-end
with a real consent gate, streamed progress, and the post-provision `HealthReport`
surfaced — the structured counterpart to the lean `setup --provision-agent` wizard
path. (Per the hybrid decision: keep the lean wizard as the optimized path; this is
the structured path that exercises detect → plan → preview → consent → execute →
verify with rollback.)

**Out of scope (follow-up):** an extension UI driving this path (the extension still
uses the lean `--provision-agent` flow); binary-production; Linux systemd executors.

## Surface

`patchwire setup --provision-remote [--yes] [--json]` plus the existing
`--host/--user/--ssh-port/--agent-port/--token/--key-path` flags.

- `--provision-remote` — drive the orchestrator instead of the lean wizard.
- `--yes` — auto-approve the consent gate (required for non-interactive / `--json`).
- `--json` — suppress human progress; emit one final JSON result.

## Design

`runProvisionRemote(input, deps = {})` in `commands/setup.ts`:

```
ProvisionRemoteInput = { host, user, port, keyPath, agentPort, token, aiBin?, yes?, json? }
deps = { provision?: typeof provisionRemote }   // injected for tests; default = real provisionRemote
```

Steps:
1. Reuse `unsafeProvisionField`-style validation (token/host/user/agentPort) — reject
   unsafe input with `{ ok:false, code:'invalid_input' }` before any SSH.
2. Build `conn: RemoteConn = { host, user, port, keyPath }` and
   `opts: RemoteExecutorOpts = { token, host: agentPort-host?, port: agentPort, aiBin }`.
3. Build `deps` for `provisionRemote`:
   - `confirm(plan, elevation)`: if `input.yes` → true. Else if `input.json` or
     `!process.stdout.isTTY` → false (can't prompt). Else `prompts` a y/N over the
     rendered plan + elevation list.
   - `onEvent(e)`: human mode renders preview (detected os/arch + plan + elevation),
     then per-step `start/ok/degraded/failed` lines, rollback lines, and the `done`
     line. `--json` mode: no streaming (events buffered/ignored; final JSON only).
   - `verify`: `makeVerify(conn, { agentHealth: () => ({ ok: await pollAgentHealth(host, agentPort) }) })`.
4. Call `await (deps.provision ?? provisionRemote)(conn, opts, provisionDeps)`.
5. Output:
   - `--json`: `process.stdout.write(JSON.stringify({ status, detected, plan, outcome, health }))`.
   - human: a final summary line (`✓ completed` / `✗ rolled-back at <failedStep>` /
     `cancelled`) and, when present, `Health: tailnet <up|down> · agent <state>`.

`cli.ts` wires the `--provision-remote` branch (parallel to `--provision-agent`),
mapping `opts.sshPort ?? 22`, `opts.agentPort ?? 7878`, `opts.yes`, `opts.json`.

## Tests (zero real SSH — inject a fake `provision`)

`test/commands/setup-provision-remote.test.ts`:
1. **happy + --yes + --json**: fake `provision` asserts it received a `confirm` that
   returns `true` (yes), emits a couple `onEvent`s, returns
   `{status:'completed', detected, plan, outcome, health:{tailnet:true,agent:'healthy'}}`.
   Assert the emitted JSON equals that result shape.
2. **consent declined (json, no --yes)**: fake `provision` calls `confirm(plan,[])`
   → expect `false`; returns `{status:'cancelled'}`. Assert JSON `status:'cancelled'`.
3. **human progress rendering**: yes:true, json:false; fake `provision` drives
   `onEvent` with preview + step start/ok/degraded + done. Assert stdout contains the
   step ids, a degraded marker, and the final `✓ completed` + `Health:` line.
4. **invalid input guard**: unsafe host → `{ ok:false, code:'invalid_input' }`, fake
   `provision` never called.

## Verify
`pnpm -r typecheck` (4× Done) + `pnpm --filter @rebink/patchwire test` green.
