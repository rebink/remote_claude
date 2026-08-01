# Force Refresh — Design

**Date:** 2026-08-01
**Status:** Approved (brainstorm)

## Problem

When a remote working copy drifts, corrupts, or gets into a bad sync state, there is
no first-class way to reset it. The user wants a **force refresh**: purge the remote
project folder and re-seed it fresh from the local machine, then resume live sync.

## Decisions (locked)

- **Surface:** CLI command + VSCode extension command. (Desktop app rides the CLI
  sidecar later; not wired in this change.)
- **Source of truth:** local wins. After the purge, the remote is re-seeded by rsync
  from local. Any remote-only uncommitted work is discarded.
- **Safety:** typed confirmation. CLI requires `--yes` (interactive shell may also
  accept a typed project-name match); extension requires typing the project name.

## Architecture

Reuse existing primitives; add one orchestrator + one UI entry.

- **CLI:** new `patchwire refresh` command in `packages/cli`.
- **Extension:** new `patchwire.forceRefresh` command in `packages/extension`
  (panel button + command palette), which shells out to the CLI via the existing
  `CliClient` streaming pattern.

The CLI owns the logic; the extension owns the confirm UX.

## CLI `patchwire refresh` — flow

Loads the mutagen target from `patchwire.yml` (project, host, user, sshPort, keyPath,
localPath = cwd, remotePath), then:

1. **Confirm guard** — refuse unless `--yes`. Interactive shells may also accept a
   typed project-name match. JSON / non-interactive callers must pass `--yes`.
2. **Terminate sync** — `stopSession(name)` so mutagen cannot fight the wipe or
   re-propagate deletions. Best-effort (fine if no session exists).
3. **Purge + reseed** — `bootstrapSnapshot({ ...target, overwrite: true })`:
   probe → **wipe (`rm -rf remotePath`)** → mkdir → **rsync local→remote** →
   git_init → safety.
4. **Recreate sync** — `ensureSession(target)` → fresh mutagen session (worktree-
   scoped hashed name).
5. Stream JSON step events (reuse `BootstrapEvent`) + a final
   `{ type: 'refresh_done', ok }`.

## Extension `patchwire.forceRefresh`

- Panel button + command-palette entry.
- `showInputBox`: *"Type `<project>` to confirm — this deletes the remote copy and
  re-seeds from this machine."* Mismatch → cancel, no action.
- On match → spawn CLI `refresh --yes --json`, stream step events to the Patchwire
  output channel + sync status indicator.

## Error handling

- Terminate fails → continue (session likely absent).
- **Wipe / rsync / git_init fails → abort, do NOT recreate the sync session.** The
  remote is half-reset; re-syncing would propagate a broken state. Report clearly:
  "remote left partially reset — re-run refresh."
- No destructive step runs before the confirm passes.

## Testing

- **CLI** `runRefresh` unit test with mocked `runSsh` / `runRsync` / mutagen runner:
  asserts order terminate → wipe → rsync → git_init → recreate; refuses without
  `--yes`; aborts and skips recreate on wipe failure.
- **Extension** command-handler test: cancels on typed-name mismatch; spawns
  `refresh --yes` on match.

## Out of scope (YAGNI)

- Remote backup/snapshot before wipe.
- Desktop-app button (rides the CLI sidecar; wire later).
- Stopping a running remote Claude/daemon before the wipe.
