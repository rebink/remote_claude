# Design: "Dangerously skip permissions" toggle

**Date:** 2026-06-11
**Status:** Approved (pending spec review)
**Component:** `packages/extension`

## Summary

Add a boolean VS Code setting, `patchwire.dangerouslySkipPermissions`, that, when
enabled, launches the session-terminal `claude` process with the
`--dangerously-skip-permissions` flag. The flag bypasses all of Claude's
tool-permission prompts for that session. When the toggle is on, a red warning
line is appended to the existing Patchwire terminal banner so the bypass is
always visible.

Default is `false` (off). No new UI, no message-passing, no new files.

## Motivation

Users running Claude in trusted environments want to skip the per-tool permission
prompts without manually editing the launch command. The extension currently
hard-codes `exec zsh -lic claude` in `sessionTerminal.ts`, so there is no way to
pass the flag. A simple persistent setting is the lowest-friction way to control
it and matches the existing `patchwire.cliPath` configuration pattern.

## Scope

**In scope**
- New boolean setting in the extension's `contributes.configuration`.
- Conditional construction of the remote `claude` command in `openSessionTerminal`.
- A red warning banner line in the session terminal when the flag is active.
- A test asserting the command string (and quoting) for both setting states.

**Out of scope (YAGNI)**
- Command-palette toggle command.
- Chat-panel webview UI control.
- Per-project overrides beyond what VS Code workspace-level settings already provide.
- A one-time warning toast (the terminal banner covers visibility).

## Design

### 1. Setting definition

File: `packages/extension/package.json`, under
`contributes.configuration.properties` (alongside `patchwire.cliPath`):

```jsonc
"patchwire.dangerouslySkipPermissions": {
  "type": "boolean",
  "default": false,
  "markdownDescription": "⚠️ Launch Claude with `--dangerously-skip-permissions`, bypassing ALL of Claude's tool-permission prompts in the session terminal. Only enable on machines/projects you fully trust."
}
```

- Default `false` — the safe state; the flag is opt-in.
- Default config scope (`window`) so it can be set at user or workspace level.

### 2. Launch logic

File: `packages/extension/src/session/sessionTerminal.ts`, inside
`openSessionTerminal(target)`.

Read the setting at launch time (re-read on every call, so a changed setting
takes effect on the next session open — no window reload needed):

```ts
const skip = vscode.workspace
  .getConfiguration('patchwire')
  .get<boolean>('dangerouslySkipPermissions') ?? false;

const claudeCmd = skip ? 'claude --dangerously-skip-permissions' : 'claude';
```

Change the remote exec line from:

```ts
`exec zsh -lic claude`,
```

to a single-quoted form:

```ts
`exec zsh -lic '${claudeCmd}'`,
```

**Quoting is load-bearing.** The whole `remoteCmd` string is sent as one SSH
argument and parsed by the remote login shell. Single-quoting `claudeCmd` makes
the remote shell pass `claude --dangerously-skip-permissions` as a single
argument to zsh's `-c`. Without the quotes, the remote shell would split on
whitespace and bind `--dangerously-skip-permissions` to zsh (as a positional
arg `$0`) rather than to claude, silently dropping the flag.

The flag string is a fixed literal (not user input), so the single-quoting
introduces no injection surface. `target.remotePath` and `target.project`
handling is unchanged.

### 3. Banner warning

Same file, in the `remoteCmd` chain. The existing banner prints a cyan line:

```ts
`printf '\\033[36m── Patchwire · %s:%s\\033[0m\\n' "$(hostname)" "$(pwd)"`,
```

When `skip` is true, add a second red warning line after it:

```ts
`printf '\\033[31m⚠ permissions bypassed (--dangerously-skip-permissions)\\033[0m\\n'`
```

Build the chain conditionally so the warning line is only present when the flag
is on:

```ts
const remoteParts = [
  `cd ${target.remotePath}`,
  `printf '\\033[36m── Patchwire · %s:%s\\033[0m\\n' "$(hostname)" "$(pwd)"`,
];
if (skip) {
  remoteParts.push(
    `printf '\\033[31m⚠ permissions bypassed (--dangerously-skip-permissions)\\033[0m\\n'`,
  );
}
remoteParts.push(`exec zsh -lic '${claudeCmd}'`);
const remoteCmd = remoteParts.join(' && ');
```

## Data flow

```
VS Code setting (patchwire.dangerouslySkipPermissions)
        │  read at launch via getConfiguration().get<boolean>()
        ▼
openSessionTerminal(target)
        │  builds claudeCmd + optional banner line
        ▼
SSH shellArgs → remote login shell → zsh -lic '<claudeCmd>'
```

No persistent state in the extension; the VS Code settings store is the single
source of truth. The value is read fresh on each `openSessionTerminal` call.

## Error handling / edge cases

- **Setting unset / wrong type:** `get<boolean>(...)` returns `undefined`;
  the `?? false` fallback yields the safe off state.
- **Existing terminal reused:** `openSessionTerminal` returns an already-open
  terminal early (before building the command). A setting change therefore does
  not retro-apply to a running session — the user must close that terminal and
  open a new session for the change to take effect. This matches current
  behavior for any launch-time configuration and is acceptable.
- **Flag unsupported by an old claude binary:** out of scope; the flag is a
  documented Claude CLI option and failure surfaces directly in the terminal.

## Testing

Add/extend a unit test around the command-string construction in
`sessionTerminal.ts`:

- With the setting `true`: the assembled remote command contains
  `exec zsh -lic 'claude --dangerously-skip-permissions'` and the red warning
  `printf` line.
- With the setting `false`/unset: the command contains `exec zsh -lic 'claude'`
  (or the original unquoted form, whichever the implementation lands on) and
  **no** warning line, and does **not** contain `--dangerously-skip-permissions`.

If `openSessionTerminal` is not currently structured for unit testing (it calls
`vscode.window.createTerminal` directly), the plan will extract the
remote-command assembly into a small pure helper (e.g.
`buildSessionRemoteCommand(target, { skipPermissions })`) that returns the
`shellArgs`/`remoteCmd`, and test that helper. The exact test harness is
confirmed during plan writing against the repo's existing extension test setup.

## Files touched

- `packages/extension/package.json` — new configuration property.
- `packages/extension/src/session/sessionTerminal.ts` — conditional command +
  banner; possible extraction of a pure helper for testability.
- A test file under the extension's test directory (path confirmed in the plan).
