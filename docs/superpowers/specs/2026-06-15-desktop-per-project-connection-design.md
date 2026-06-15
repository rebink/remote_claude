# Patchwire Desktop — Per-Project Connection + Guided Setup Wizard (Design Spec)

**Date:** 2026-06-15
**Status:** Design approved (brainstorming), pending implementation plan
**Revises:** the P1 decision of a single global connection for all projects. The desktop now mirrors the VS Code extension's **per-project** model.

## Summary

Replace the desktop's global-connection model (a single `connection.json` + a raw host/user/key Connect form) with the **extension's per-project model**: every project is a local folder with its own `patchwire.yml` (its own remote host/user, per-project SSH key, token, and mutagen session), and projects may point to **different machines**. A project that isn't configured is set up through a **guided 4-step wizard** (mirroring the extension), not a raw form.

This was triggered by live testing: the global raw Connect screen "is not the way I had in mind — show the same connection option like in the extension … and for every project it should be a different session."

## Locked decisions (brainstorm, 2026-06-15)

| Decision | Choice |
|---|---|
| Connection scope | **Per-project, any machine** (extension model). No global connection. |
| Setup UX | **Guided 4-step wizard** (not a quick form, not tailscale-first). |
| Step 2 key install | **Open Terminal with the command** (extension-style). The SSH password never touches the app. |
| Provision engine | **Reuse** the kept ops-console Rust `start_provision`/`send_consent` + the `provision-state.ts` reducer + step UI. |
| Phasing | **P4a** (model refactor) → **P4b** (the wizard). |

## Audience & core job

- **Persona:** a developer who owns one or more remote machines and works on several local project folders, each synced to (possibly different) remotes — exactly the extension's mental model, but in a standalone, editor-agnostic app that lists all their projects.
- **First run:** no projects → an empty Projects list with a prominent "Set up your first project" → the wizard.
- **Daily:** open a configured project → its Workspace (own chat session + own sync, unchanged from P2/P3).

## New information architecture

```
App opens → Projects list (the home; no connect gate)
   ├─ empty (new user)        → "Set up your first project" → WIZARD
   ├─ "+ Add / Set up project" → pick a local folder
   │        ├─ folder has patchwire.yml → read it → add to the list
   │        └─ no patchwire.yml          → WIZARD (per-project setup)
   ├─ each project row         → its OWN user@host + sync status pill
   └─ open a project           → Workspace (own session + sync — P2/P3, unchanged)
```

No `connect` route. App routes are: **Projects** (default) · **Wizard** (adding/setup) · **Workspace** (opened).

## The wizard (4 steps)

Mirrors the extension; driven via the CLI `setup` command streamed through the sidecar.

1. **Machine** — enter `host`, `user`, SSH port. (Manual entry baseline; a tailnet-peer picker is a future nicety — the CLI already supports tailscale detection.)
2. **SSH key** — the per-project key is `~/.patchwire/keys/<host>-<user>`. If missing, generate it (`ssh-keygen`). Show the exact `ssh-copy-id -i <key>.pub -p <port> <user>@<host>` command with an **"Open in Terminal"** button (Tauri opener launches Terminal.app prefilled). The user types the SSH password once in their own terminal, returns, clicks **"I've installed the key"** → the wizard **verifies** the key works (a key-only SSH probe; reuse the `host-check`/`setup --verify-key` path). The password never enters the app.
3. **Project source** — confirm the local folder (already chosen at add-time) + the remote path (default e.g. `~/workspace/<project>`) + project name.
4. **Verify + provision** — run **`start_provision`** (streams `setup --provision-remote --stream --token-stdin`) **with the sidecar `current_dir` set to the chosen local folder**, plus `--project/--path/--host/--user/--ssh-port/--key-path/--agent-port` and the token via stdin. This writes the **local** `patchwire.yml` into the folder and installs + starts the agent on the remote, generating a per-project token. The streamed steps drive the **kept `provision-state` reducer** + step-icon UI (✓/⚠/✗/…). On success → write the project into `projects.json` (with denormalized `host`/`user`/`remotePath` for display) → it appears in the list, ready to open.

**Note:** `start_provision` currently has no `current_dir` and no `--project/--path` args wired for this use — P4b adds those (the chat/sync sidecars already set `current_dir`, so the pattern exists).

## Data model changes

- **`Project`** record gains `host: string` and `user: string` (denormalized for the row display; **source of truth = the project's `patchwire.yml`**). `remotePath` already exists.
- **Removed:** `Connection` type, `connection.json`, the `connection` store, the `route: "connect"|"projects"` derived store.
- **Per-project remote for existing entries:** on landing load, for any project whose record lacks `host`/`user`, read its `patchwire.yml` to fill them (a small CLI `config --json` seam, or read the file). Best-effort; degrade to "unconfigured" if absent.

## Components & migration (P4a touches merged P1 code)

- **Delete:** `src/screens/Connect.svelte` (+ test); the global single-remote `src/components/ConnectionBar.svelte` (+ test) — the workspace never used it and the landing drops the global bar; the `connection`/`route` parts of `src/lib/stores.ts`; the Rust `read_connection`/`save_connection` commands + their ipc wrappers + the `connectionToHostArgs`/`checkHealth`-as-global usage (keep `checkHealth` if reused per-project, else drop).
- **Rework:** `src/screens/Projects.svelte` — no `ConnectionBar`; each `ProjectRow` shows its own `user@host`; empty state CTA launches the wizard. `src/App.svelte` — routes Projects/Wizard/Workspace; no connect route. `src/components/AddProjectDialog.svelte` (or its flow) — folder pick branches: has `patchwire.yml` → add; else → wizard.
- **`ProjectRow.svelte`** — add a `user@host` line above/with the path mapping.
- **New (P4b):** `src/screens/SetupWizard.svelte` (the 4-step flow) + step components; reuse `provision-state.ts` (kept reducer) for Step 4 streaming.

## Data flow — setup a new project

1. User picks a local folder with no `patchwire.yml` → wizard opens (Step 1).
2. Steps 1–3 collect host/user/port/remotePath/project; Step 2 generates the key + Open-Terminal install + verify.
3. Step 4: `invoke('start_provision', { args: { projectDir: localPath, host, user, sshPort, keyPath, agentPort, project, remotePath } })` → Rust spawns the sidecar `setup --provision-remote --stream --token-stdin` with `current_dir=localPath` → streams `pw://prov` events → `provision-state` reducer drives the step UI → `pw://prov-end`.
4. On success: the local `patchwire.yml` exists in the folder; save the project to `projects.json` (with `host`/`user`/`remotePath`); return to the list with the new project.

## Error handling

| Failure | Behavior |
|---|---|
| Key verify fails (Step 2) | Stay on Step 2; show the manual command + "key not yet working" hint; allow retry. |
| Provision step fails (Step 4) | The `provision-state` step shows ✗ + the error line; user can retry the step or cancel the wizard. |
| Folder already has `patchwire.yml` | Skip the wizard; read it and add directly. |
| `patchwire.yml` unreadable/old shape on landing | Row shows "unconfigured"/unknown; re-run setup offered. |

## Out of scope

- Tailscale-peer picker in the wizard (manual host entry for v1; CLI tailscale detection is a later enhancement).
- In-app SSH password capture (Open-Terminal only).
- A global connection / shared-machine mode (explicitly rejected).
- Settings screen (separate, later).

## Testing

- **Pure TS (P4a):** the `Project` record changes + any per-project config parsing helper (TDD).
- **Components:** `ProjectRow` shows `user@host`; `Projects` empty-state CTA + add-folder branching (has-yml vs wizard); the wizard step reducer + Step transitions (`provision-state` already tested — reuse).
- **Rust:** `start_provision` gains `current_dir` + `--project/--path` args (verified by `cargo check` + the existing provision tests / live run).
- **End-to-end (human):** the real wizard against a reachable machine — Step 2 terminal key install, Step 4 live provision — is the live milestone (alongside the still-pending chat/sync E2E).

## Phasing

- **P4a — per-project model refactor:** rip out the global connection (Connect screen, ConnectionBar, connection store/json, read/save_connection, route logic); make `Project` carry `host`/`user`; rework Projects landing (per-project rows + empty state), App routing, and add-folder branching (has-yml → add; else → a wizard placeholder route). Ships a working per-project landing for already-configured projects.
- **P4b — the guided wizard:** `SetupWizard.svelte` (Steps 1–4), key-gen + Open-Terminal install + verify, `start_provision` `current_dir`/`--project`/`--path` additions + Step-4 streaming via `provision-state`, write `patchwire.yml` + `projects.json`. Ships the full guided setup.

## Open items for the implementation plan
- Confirm the exact `setup --provision-remote` behavior: does it write the local `patchwire.yml` itself, or must the desktop write it before/after? (Read `packages/cli/src/commands/setup.ts`.)
- The per-project remote read for the landing: existing CLI seam (`config --json`?) vs reading `patchwire.yml` directly.
- Whether to keep `checkHealth`/`ConnectionBar` in any per-project form (a per-project health dot on the row) or rely solely on the sync pill.
