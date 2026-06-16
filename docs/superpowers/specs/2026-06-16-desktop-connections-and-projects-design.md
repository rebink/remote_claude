# Patchwire Desktop — Connections & Projects (two-level model) Design Spec

**Date:** 2026-06-16
**Status:** Design approved (brainstorming), pending implementation plan
**Revises:** P4a's "per-project, any-machine, no connection" model. After live testing, the user reframed the flow around an explicit **Connection** (a remote machine) that owns **Projects**.

## Summary

Restructure the desktop app around two concepts:

- A **Connection** is a remote machine the app has provisioned (agent installed). Provisioning happens **once per machine** at connect time. The app holds **multiple** connections; the user picks one to work under.
- A **Project** is a local folder mapped to a **remote copy on a connection**. Selecting a local folder makes the app **create the copy on the remote** (initial push) and then run continuous two-way **sync**; the workspace (chat/diff/apply) operates against that synced project.

This separates *machine setup* (heavy, once per machine — install agent + deps) from *project setup* (light — pick a folder, auto remote path, copy + sync), and supports several machines.

## Locked decisions (brainstorm, 2026-06-16)

| Decision | Choice |
|---|---|
| Connection cardinality | **Multiple** machines; one selected/active at a time |
| Provisioning | At **Add-connection**, once per machine (agent-only) |
| Add-project remote copy | App **auto-creates** the remote path by default; user may override |
| Default remote path | `~/patchwire/<name>` |
| Add-project connection | A **connection selector** (defaults to the current connection) |
| First run (no connections) | Go straight to the **Add-connection** screen |

## Concepts / data model

**Connection** (persisted in `connections.json`, an array — mirrors the old `hosts.json` pattern):
```
{ id, name, host, user, sshPort, keyPath, agentPort, token, agentVersion }
```
- `name` — friendly label. `token` — the connection-level agent token (generated at provision). Multiple connections allowed.

**Project** (persisted in `projects.json`; gains `connectionId`):
```
{ id, connectionId, name, localPath, remotePath, branch, lastStatus, syncPaused }
```
- A project belongs to exactly one connection. Its `patchwire.yml` (written in `localPath`) derives `remote.host/user/sshPort/token` from the connection and `remote.path` from `remotePath` (default `~/patchwire/<name>`).

## Information architecture

```
No connections → Add-connection screen (first run)
Connections list (see all machines + health)
  ├─ + Add connection → SETUP WIZARD (machine → key → verify → provision agent, ONCE) → save Connection
  └─ select a connection (active)
       → Projects screen (this connection's projects, filtered by connectionId) + per-project sync pills
            ├─ + Add project → pick CONNECTION (dropdown, default = current) + local folder
            │        + remote path (auto ~/patchwire/<name>, editable)
            │        → write patchwire.yml (from the connection) → initial copy (push) → start sync → save
            └─ open project → Workspace (chat / diff / apply + sync — P2/P3, unchanged)
```

App routes: **Connections** (default; empty → Add-connection) · **AddConnectionWizard** · **Projects** (for the selected connection) · **AddProject** · **Workspace**.

## Flow A — Add-connection (provision a machine, once)

Repurposes the existing `SetupWizard` (P4b), re-scoped to a Connection:
1. **Machine** — connection name + host / user / SSH port.
2. **SSH key** — `ensure_ssh_key` → Open-Terminal `ssh-copy-id` → `verify_key`.
3. **Provision** — generate a connection-level token; run the streamed **agent-only** install (bootstrap-agent → install-claude → install-mutagen → write-secret → install-service → apply-egress → bind-tailnet) via the provision engine, **without writing a project `patchwire.yml`**. On `completed` → save the Connection.

**New seam — provision-only:** today `start_provision` is project-scoped (P4b added `--project/--path` + `current_dir` so `setup` writes the project yml). Add-connection has no project, so it needs an **agent-only provision** (the 7 install steps, no project config write). Implemented as a provision mode/flag that skips the local-yml write (and a Rust command variant that doesn't require `project_dir`/`project`/`remote_path`).

## Flow B — Add-project (create remote copy + sync, NO provision)

New lightweight flow (no agent install — the connection is already provisioned):
1. Pick **connection** (dropdown, default current) + **local folder** + **remote path** (auto `~/patchwire/<name>`, editable).
2. **Write** the local `patchwire.yml` from the chosen connection (host/user/sshPort/token/agentUrl) + the remote path — via `setup` (non-provision) or an equivalent write.
3. **Initial copy** — push local→remote (`sync`, which rsync-creates the remote dir + copies).
4. **Start continuous sync** — `sync-start` (mutagen) from P3a.
5. **Save** the Project `{connectionId, name, localPath, remotePath, …}`.

Reuses existing CLI seams: `setup` (write yml), `sync` (initial push), `sync-start` (mutagen).

## What changes in current code (post P4a/P4b on `main`)

- **Re-introduce Connection** (P4a deleted the single global connection): `connections.json` + Rust `list_connections`/`save_connection`/`delete_connection`; a connections store + active-connection state; a **Connections list** screen.
- **Project gains `connectionId`**; its remote details derive from the connection. Projects screen filters by the selected connection.
- **`SetupWizard` → Add-connection:** add a connection name; provision agent-only (provision-only seam); save a Connection (not a project).
- **Replace `AddProjectDialog` branching** (P4a's has-yml / `onneedssetup`→wizard) with the new **Add-project** flow (connection picker + folder + remote path → write yml + initial push + sync-start).
- **App routing** reworked to Connections → Projects → Workspace (+ the two add flows).

**Reused unchanged:** Workspace + chat/diff/apply (P2); all sync (P3a/P3b); the wizard's machine/key/provision step UI + `provision-state` reducer (P4b); `read_project_config`/`config-show`; `ensure_ssh_key`/`verify_key`/`open_terminal`.

## Error handling

| Failure | Behavior |
|---|---|
| No connections | Add-connection screen (first run) |
| Provision step fails (Add-connection) | `provision-state` step shows ✗ + detail (P4b fix); retry/cancel; no Connection saved |
| Connection unreachable later | Connections list shows the machine unhealthy; projects under it surface sync/agent errors |
| Initial copy/push fails (Add-project) | Surface the error; do not save the project; allow retry |
| Sync conflict | Surfaced in the workspace (P3b) |

## Out of scope

- Editing/renaming/removing connections beyond add + delete (a later settings pass).
- Tailscale-peer picker in Add-connection (manual host entry; CLI tailscale support is a later nicety).
- Moving a project between connections (re-add instead).
- Windows/Linux `open_terminal` branches (macOS-first).

## Testing

- **Pure TS:** Connection/Project model + `connectionId` wiring; the Add-project config/path builders (TDD).
- **Components:** Connections list (empty → add; list + select), Add-project (connection dropdown + folder + remote path → the right IPC calls), Projects filtered by connection.
- **Rust:** `list_connections`/`save_connection`/`delete_connection`; the provision-only command (cargo check + the existing provision tests).
- **End-to-end (human):** add a connection (provision a real machine) → add a project (folder → remote copy + sync) → workspace chat/diff/apply. (Now unblocked — the provision bug is fixed; agent healthy on `100.100.100.100`.)

## Phasing

- **P5a — Connections foundation:** Connection type + `connections.json` persistence (Rust list/save/delete) + connections store + active selection + **Connections list** screen + App routing (Connections → Projects filtered by `connectionId`); `Project` gains `connectionId`; repurpose `SetupWizard` → **Add-connection** (provision-only seam + save Connection). *Ships: connect to machines, see them, enter a machine's (existing) projects.*
- **P5b — Add-project copy+sync:** the new lightweight **Add-project** flow (connection dropdown + folder + auto remote path → write yml + initial copy + `sync-start` → save). Replaces `AddProjectDialog`. *Ships: add a project = pick a folder → remote copy + sync.*

Each phase ships working, testable software.

## Open items for the implementation plan (P5a)

- Exact provision-only seam: a `setup --provision-remote --no-config` (skip the local yml write) flag, or a Rust `provision_connection` that runs the install steps without `project_dir`/`project`/`remote_path`. Read `packages/cli/src/commands/setup.ts` + the provision orchestrator to choose the cleanest cut.
- How the connection-level token is generated + stored, and how a project's `patchwire.yml` references it (the connection token vs a per-project token — use the connection token).
- Migration of any existing `projects.json` entries lacking `connectionId` (in practice none yet; default/skip).
