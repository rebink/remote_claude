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

## Status

- **Phase 1** (engine + CLI): unit-green.
- **Phase 2** (desktop UI + manager hardening): unit-green — CLI 629 tests, desktop 156 tests, `cargo build` clean. This runbook is the gating manual validation on a real provisioned host.
