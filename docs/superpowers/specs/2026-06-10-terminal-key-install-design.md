# Terminal-based key install (drop sshpass) — design

**Date:** 2026-06-10
**Status:** approved in brainstorming → ready for spec review
**Surface:** VS Code extension setup wizard Step 2 + a small CLI verify mode; removes sshpass from the project.

## Goal

Install the per-project SSH key on the remote **without `sshpass`**. Step 2 opens a
VS Code terminal running `ssh-copy-id` (the user types their password there,
interactively), then a "Verify & continue" button confirms key-based SSH works and
advances. This removes the GPL native-binary dependency entirely and the brew-tap
onboarding friction.

## Context (why)

- Today Step 2 sends the password to the bundled CLI, which runs `ssh-copy-id` via
  `sshpass`. On a fresh Mac, `sshpass` is neither bundled in the `.vsix` nor installed
  by default, so the key install failed (fixed to surface the error in 0.3.14, but the
  underlying friction remains).
- `sshpass` is GPLv2 and per-platform; bundling it into an MIT extension is awkward
  (license obligations + a CI binary matrix). `ssh-keygen` / `ssh-copy-id` / `ssh`
  ship with macOS and Linux by default, so a terminal-driven flow needs no binary.

## New Step 2 flow

1. **Username** field stays (pre-filled from Step 1). **Password field is removed.**
2. **"Open terminal & install key"** button → the host opens a VS Code terminal named
   `Patchwire: install key` and runs one POSIX command:
   ```
   mkdir -p ~/.patchwire/keys && ([ -f <key> ] || ssh-keygen -t ed25519 -N '' -C patchwire -f <key>) && ssh-copy-id -i <key>.pub -p <port> <user>@<host>
   ```
   where `<key>` = `~/.patchwire/keys/<host>-<user>`. The user enters their Mac password
   when `ssh-copy-id` prompts, and accepts the host key if asked — both handled
   naturally by ssh in the terminal. The host stores `keyPath` in wizard state.
3. **"Verify & continue"** button → the host runs the CLI verify (below). On success it
   advances to Step 3; otherwise it shows "Not connected yet — finish the steps in the
   terminal, then click Verify."

The old result-driven special cases (`auth_failed`, `unreachable`,
`host_key_mismatch` / "Trust new key") go away: those are now visible and handled
**in the terminal** by ssh itself.

## CLI: `patchwire setup --verify-key`

A new mode in `packages/cli/src/commands/setup.ts` (sibling to `--password-stdin`):

```
patchwire setup --verify-key --host <h> --user <u> --ssh-port <p> --key-path <key>
```

Runs a key-only, non-interactive check and prints JSON:

```ts
spawnSync('ssh', [
  '-i', keyPath,
  '-o', 'BatchMode=yes',                  // never prompt for a password
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=6',
  '-p', String(port),
  `${user}@${host}`,
  'true',
]);
// → { ok: true } on exit 0, else { ok: false, code: 'verify_failed', stderr }
```

`BatchMode=yes` guarantees it can only pass when the key is actually installed (no
password fallback). This is testable (stub `spawnSync`).

## Extension wiring

- **Webview (`setup/webview/main.ts`) `renderStep2`:** drop the password input + the
  `step2Submit`/result UI; add two buttons that post `openKeyInstallTerminal` and
  `verifyKey` (both carry `{ user }`), plus short instructions and a status line.
- **Host (`SetupWizard.ts`):**
  - `openKeyInstallTerminal`: compute `keyPath`, build the one-liner, `keyPath` into
    state, `vscode.window.createTerminal(...)`, `terminal.sendText(cmd)`, `terminal.show()`.
  - `verifyKey`: spawn the bundled CLI `setup --verify-key ...` (via `resolveCli`),
    log stdout/stderr/exit to the output channel (per the 0.3.14 fix), parse JSON; on
    `ok` set `step: 3`, else post a `step2Result` error the webview renders.
  - Remove the `step2Submit` case (and its password handling).

## Removal of sshpass

The wizard was the only consumer of the password path, so this also deletes:
- `packages/cli/src/commands/setup.ts` `runSetupPasswordStdin` + the `--password-stdin`
  option in `cli.ts`.
- `packages/cli/src/lib/sshpass.ts` (+ its tests).
- `packages/cli/scripts/fetch-sshpass.sh` and the `postinstall` that runs it.
- `packages/cli/vendor/sshpass/` and any `.vscodeignore`/bundle references.

Net result: **sshpass leaves the project entirely** (no GPL binary anywhere).

## Edge cases

- **Host-key changed** ("REMOTE HOST IDENTIFICATION HAS CHANGED"): `ssh-copy-id` shows
  the warning in the terminal. The Step 2 help text notes: if you see this, run
  `ssh-keygen -R <host>` then retry. (Not auto-run, to avoid silently trusting a
  changed host key.)
- **`ssh-copy-id` missing** (extremely rare on macOS/Linux): the verify will fail; the
  status line tells the user the key isn't installed yet.
- **Verify clicked too early** (before finishing the terminal): verify returns not-ok,
  the user is told to finish and retry. No state change.

## Testing

- **CLI:** `setup --verify-key` returns `{ok:true}` when `ssh ... true` exits 0 and a
  structured `{ok:false, code:'verify_failed'}` otherwise (stub `spawnSync`). Add to
  the existing setup tests; delete the `--password-stdin` tests with that code.
- **Extension host:** the `verifyKey` handler advances to step 3 on `{ok:true}` and
  posts an error otherwise (stub the spawned CLI + the panel). `openKeyInstallTerminal`
  creates a terminal and sends a command containing `ssh-copy-id` and the key path
  (stub `vscode.window.createTerminal`).
- **Webview:** no harness; manual render note.

## Out of scope

- **Windows laptops.** `ssh-copy-id` is not part of Windows OpenSSH and the command is
  POSIX shell. Patchwire is macOS/Linux-only today across the whole stack (bash scripts,
  rsync, Mutagen, the old sshpass binaries), so this does not change platform scope.
- Auto-detecting terminal completion via shell-integration exit codes (version-dependent
  and flaky) — the explicit "Verify" button is used instead.
- Non-interactive / headless setup (the CLI still supports key-based flows directly).

## Success criteria

- On a fresh macOS/Linux machine with **no sshpass**, a developer completes Step 2 by
  clicking "Open terminal & install key", entering their password in the terminal, and
  clicking "Verify & continue" → advances to Step 3.
- The verify only passes when key-based SSH actually works (`BatchMode=yes`).
- `sshpass`, `--password-stdin`, `fetch-sshpass.sh`, and `vendor/sshpass/` are gone from
  the repo; the `.vsix` ships no native binary.
