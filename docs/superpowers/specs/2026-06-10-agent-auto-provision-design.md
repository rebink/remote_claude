# Auto-provision the patchwire-agent over SSH — design

**Date:** 2026-06-10
**Status:** approved in brainstorming → ready for spec review
**Surface:** new CLI mode `setup --provision-agent` + a small `patchwire-agent install` hardening + setup-wizard wiring.

## Goal

After the user enters their connection and completes the one-time key install, the
setup wizard provisions the remote `patchwire-agent` **in the background** with no
extra manual steps: it installs the CLI on the remote if missing, starts the agent
bound to a reachable address, sets the token on both ends (no copy-paste), and waits
until `/health` is green. Result: the CLI `patchwire ask` flow and `patchwire doctor`
work out of the box, so users aren't sent off to SSH into the remote and run commands.

## Context (what makes this non-trivial)

- The **extension's own flow** (Focus Claude session + Mutagen two-way sync) does **not**
  use the agent. The agent (`:7878`) is only for the **CLI `patchwire ask`** diff flow
  and `doctor`. So provisioning it is about making the *full* stack hands-off, and must
  be **non-blocking**: if it can't finish, the extension still works.
- `patchwire-agent install` (`cli/src/commands/daemon.ts`) is **macOS-only** (launchd),
  defaults the bind host to **`127.0.0.1`** (not reachable from the laptop), and runs
  `launchctl load`, which over a **non-interactive SSH session only starts reliably when
  the remote user is logged into the GUI** (true for a typical always-on Mac Mini).
- Non-interactive SSH has a minimal `PATH`, so `node`/`npm`/`patchwire-agent` must be
  invoked through a **login shell** (`ssh host 'bash -lc "…"'`).

## Architecture

A new CLI mode on the laptop drives everything; the wizard calls it and shows progress.

### CLI: `patchwire setup --provision-agent`

```
patchwire setup --provision-agent \
  --host <h> --user <u> --ssh-port <p> --key-path <key> \
  --agent-port <ap> --token <hex>
```

Runs, in order, and prints a single JSON result `{ ok, code, stderr, healthy }`:

1. **Remote install + start** over SSH using the per-project key only
   (`-i <key> -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new`),
   through a login shell so `PATH` is populated:
   ```
   ssh … <u>@<h> 'bash -lc "set -e;
     command -v node >/dev/null || { echo PW_NO_NODE; exit 3; };
     command -v patchwire-agent >/dev/null || npm i -g @rebink/patchwire;
     patchwire-agent install --token <hex> --host <h> --port <ap>"'
   ```
   `--host <h>` binds the agent to the address the laptop uses (not loopback);
   `--token <hex>` is the token the laptop generated, so nothing needs to be parsed
   back. `PW_NO_NODE` → a clear "install Node 20+ on the remote" error.
2. **Write the token locally**: `~/.patchwire/env` gets `PW_TOKEN=<hex>` (chmod 600).
   `patchwire.yml` already references `token: ${PW_TOKEN}`, so the laptop is configured.
3. **Poll `/health`**: hit `http://<h>:<ap>/health` (via the CLI's own HTTP client, not
   curl) for up to ~15s. `healthy: true` once it responds.

The mode returns structured failures the wizard surfaces verbatim:
- `code: 'no_node'` → remote lacks Node ≥20.
- `code: 'install_failed'` → `npm i -g` or `patchwire-agent install` failed (stderr included).
- `code: 'launchd_unstarted'` → installed, but `launchctl` couldn't start it over SSH
  (the common headless case); `stderr` includes the one manual command + the plist path.
- `code: 'unhealthy'` → started but `/health` never answered (binding/firewall); the
  wizard points at the firewall + bind host.
- `ok: true, healthy: true` → done.

### `patchwire-agent install` hardening (`daemon.ts`)

To raise the over-SSH success rate when the user **is** logged in, replace the bare
`launchctl load` with: try `launchctl bootstrap gui/$(id -u) <plist>` (the modern,
GUI-domain command), fall back to `launchctl load`, then `launchctl kickstart -k
gui/$(id -u)/<label>`. If none start it, exit non-zero with a `launchd_unstarted`-style
message and the plist path so the caller can surface a precise fallback. Keep
`--port`/`--host`/`--token` options (host/port may need adding to the option list).

### Wizard wiring (`SetupWizard.ts` + webview)

- After **Step 3 (push/bootstrap)** succeeds, the host automatically generates a token
  (`crypto.randomBytes(32).hex`) and runs the bundled CLI `setup --provision-agent …`
  (via `resolveCli`), logging stdout/stderr/exit to the output channel (per the 0.3.14
  pattern) and posting progress to the webview.
- **Non-blocking**: on success, advance to Step 4 (Doctor). On a provisioning failure,
  show the structured message (e.g. "Agent installed but couldn't start over SSH — run
  `launchctl bootstrap gui/$(id -u) <plist>` on the remote, or just use the extension;
  the agent is only needed for the `patchwire ask` CLI") and still let the user finish —
  the extension's session + sync do not depend on it.
- The webview Step 4 / status reflects the agent state; `doctor`'s `/health` check then
  passes.

## Idempotency & safety

- Re-running setup re-provisions cleanly: the remote install is skipped when
  `patchwire-agent` is already present, `patchwire-agent install` is idempotent, and the
  token is re-set on both ends.
- This mutates the **remote** (installs software, starts a service) — but only as part
  of a setup the user explicitly initiated, over their own key, against their own box.

## Testing

- **CLI `--provision-agent`** (vitest, stub `child_process` + the HTTP client): builds
  the correct `ssh … bash -lc "…"` argv (login shell, `IdentitiesOnly=yes`, `--token`,
  `--host`, `--port`); on remote exit 0 + healthy → `{ok:true, healthy:true}` and
  `PW_TOKEN` written to `~/.patchwire/env`; maps `PW_NO_NODE`→`no_node`, non-zero install
  →`install_failed`, healthy-poll-timeout→`unhealthy`.
- **`patchwire-agent install` hardening** (vitest, stub `spawnSync`): tries `bootstrap`,
  falls back to `load`/`kickstart`; non-zero from all → structured failure with the plist
  path. Existing daemon tests updated.
- **Wizard host**: the post-push provision spawns `setup --provision-agent` with the right
  args and is non-blocking on failure (advances anyway, surfaces the message). Webview is
  manual (render note).

## Out of scope (v1)

- **Linux remotes** (systemd over SSH). `patchwire-agent install` is macOS-only; a Linux
  remote returns a clear "run under systemd/tmux" message and the wizard surfaces it.
- **Multi-developer per-user tokens** (`patchwire-agent user add`). v1 provisions the
  single default token; teams keep using the documented per-user flow.
- Installing **Node** on the remote for the user (we detect + instruct, not install).
- A retry/repair UI beyond re-running setup.

## Success criteria

- On a fresh, logged-in **Mac Mini** with Node ≥20, finishing the wizard leaves
  `patchwire doctor` all-green with **zero manual SSH** and no token copy-paste.
- The agent binds to the reachable host (not `127.0.0.1`) and `/health` answers from the
  laptop.
- If provisioning can't complete (headless, no Node, firewall), the wizard says exactly
  what to do and **still lets the user finish** — the extension's session + sync work
  regardless.
