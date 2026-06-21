# Service Projection — Manual E2E Runbook (Phase 1)

Validates the full local→remote loop: discover → reverse-tunnel → same-port mirror → manifest → MCP registry. Run against a real provisioned agent host.

**Prereqs**
- A provisioned remote agent reachable via `patchwire.yml` in the project cwd (the per-project SSH key lives at `~/.patchwire/keys/<host>-<user>`; bind falls back to SSH-agent auth if absent).
- Docker running locally with a Postgres container published on `:5432`.
- Build the CLI once: `pnpm --filter @rebink/patchwire build` (or use `dev:cli`).

**Steps**

1. Start a local Postgres:
   ```
   docker run --rm -e POSTGRES_PASSWORD=pw -p 5432:5432 -d postgres:16
   ```

2. Discover candidates:
   ```
   pnpm --filter @rebink/patchwire dev:cli services discover
   ```
   Expect a line like: `docker:<name>:5432   Postgres (<name>)   postgres://127.0.0.1:5432`.
   (To include Dart services, capture `flutter run` output and set `PW_DART_OUTPUT` to it.)

3. Bind by port:
   ```
   pnpm --filter @rebink/patchwire dev:cli services bind 5432 --yes
   ```
   Expect: `Bound Postgres ...: 127.0.0.1:5432 on remote (mirrored).` plus a status line `docker:...:5432  5432→5432  mirror  active`.
   Note: interactive `bind` (without `--yes`) prints what will be exposed and prompts `Proceed? [y/N]` before binding; `--yes` bypasses the prompt for non-interactive use.

4. On the remote host, confirm the tunnel carries the query back to the laptop's Postgres:
   ```
   psql postgres://postgres:pw@127.0.0.1:5432 -c 'select 1'
   ```
   Expect `1`.

5. Inspect the manifest:
   ```
   cat .patchwire/services.json
   ```
   Expect one `services[]` entry: `host: "127.0.0.1"`, `remotePort: 5432`, `mirrored: true`, `status: "active"`. File mode `600`.

6. MCP registry check — point a client (or `claude` via `--mcp-config`) at `patchwire services-mcp` with `PW_SERVICES_PROJECT_DIR` set to the project dir; call `list_services` and `get_connection {id}`. Expect the same entry and a reachable `connectionHint`.

7. Auto-heal: kill the `ssh -R` tunnel process for port 5432. Expect the manager to log `reconnecting` then return to `active`, and step 4 to succeed again.

8. Port-conflict / remap: occupy remote `127.0.0.1:5432` (e.g. `ssh <host> 'nc -l 127.0.0.1 5432 &'`), re-bind with `--yes`, and expect the status line to read `remap` with a non-5432 `remotePort`, reflected in the manifest and MCP registry.

**Cleanup:** `docker stop <postgres container>`; unbind / stop the CLI session.

## Desktop (P2)

The desktop app drives the same engine via a long-lived `patchwire services serve --stream` session (one per workspace).

1. Open a project workspace in the desktop app with a local Postgres container running.
2. The Services panel auto-lists `Postgres (...)`; toggle it on → pill goes `binding`→`active`, remote `127.0.0.1:5432` shown with a copy button.
3. Reopen the workspace → the bound service auto-rebinds (persisted in the project record's `boundServiceIds`).
4. Stop the container → next discover tick marks the pill `stale`; restart it and click Retry → back to `active`.
5. Kill the `ssh -R` tunnel → pill `reconnecting` → `active` (exponential-backoff auto-heal); exhaust retries (6) → `failed` + Retry button.
6. Close the workspace → the session process is killed → all tunnels drop.

## VS Code Extension (P3)

The extension spawns the same `services serve --stream` session directly via `child_process` (no Rust) when the Services view first opens.

1. Open a project (with `patchwire.yml`) in VS Code; open the Patchwire → Services view.
2. First reveal spawns `services serve --stream`; `Postgres (...)` appears with a `circle-outline` icon.
3. Click the inline Bind (plug) icon → icon goes `sync~spin`→`pass-filled`, description shows `active · 127.0.0.1:5432`. Copy icon copies the address.
4. Reopen the window → the bound service auto-rebinds (workspaceState).
5. Stop the container → status `stale` (warning icon) after a refresh; Retry icon re-arms.
6. Close the window → the session process is killed → tunnels drop.

## Automated real-ssh harness (no remote host needed)

The manual steps above need a provisioned host. For the **core engine** there is an
automated harness that needs only local Docker: a throwaway sshd container stands in
as the remote, and the host's ssh client forwards a tunnelled Postgres back to the
host's own DB.

```
bash e2e/service-projection/run.sh
```

Proves — with real `ssh -R`, real `docker ps`, real `psql` — the discover→bind→reach
loop, the same-port-conflict **remap**, and supervised **auto-heal**. Last run: **6/6 green**.
(The desktop Tauri bridge and the VS Code extension UI still need the manual steps,
since they just drive the same CLI the harness exercises.)

## Status

- **Phase 1** (engine + CLI): unit-green + **real-ssh E2E green** (harness, 6/6).
- **Phase 2** (desktop UI + manager hardening): unit-green — CLI 630 tests, desktop 156 tests, `cargo build` clean. Engine path validated by the harness; desktop bridge needs the manual GUI steps.
- **Phase 3** (VS Code extension tree view): unit-green — extension 81 tests, typecheck + build clean. Engine path validated by the harness; extension UI needs the manual GUI steps.

The core reverse-tunnel/mirror/heal engine is now validated against real ssh+docker.
The manual runbook remains the gate for the desktop + extension UI layers on a real host.
