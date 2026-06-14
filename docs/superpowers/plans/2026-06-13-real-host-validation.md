# Real Host Validation — milestone plan

**Opened:** 2026-06-13 · **Closes:** Provisioning Overhaul v1
**Goal:** Run the complete provisioning flow against *real* hosts of every supported
OS and record findings. This is QA, not architecture — no new provisioning code
unless validation surfaces a defect.

The engine and OS matrix are merged (PRs #44–54) and unit-tested against stubbed
SSH/spawn. Nothing has touched a real host. Cross-platform shell / PowerShell /
schtasks / launchd / systemd code is exactly the kind that passes unit tests and
breaks on contact with a real box. This milestone closes that gap.

---

## Entry command (the thing under test)

```
patchwire setup --provision-remote --host <ip-or-dns> --user <ssh-user> [--ssh-port 22]
```

`--host` implies `--no-tailscale` (skips the tailnet picker). Flow:
**detect → plan → preview → consent → execute → verify**. Capture every stage.

Underlying call: `provisionRemote(conn, RemoteExecutorOpts, deps)` in
`packages/cli/src/agent/provision/provision-remote.ts`. `conn` is `RemoteConn`
(SSH opts minus `command`); opts carry the agent `token`, `port`, `aiBin`, and
optional `binarySource` (forces the prereq-free binary bootstrap).

---

## Per-host prerequisites

Each VM needs, before the run:
- SSH reachable; the operator's pubkey in the remote user's `~/.ssh/authorized_keys`
  (passwordless — the run is non-interactive after consent).
- A non-root user with `sudo` for the elevation-gated steps (service install).
- **Tailscale decision (see gotcha):** either pre-install + `tailscale up` on the VM,
  or accept that `verify.tailnet=false` and validate agent `/health` directly on
  `host:7878` instead.

---

## Validation matrix

Two axes that actually change the code path: **OS** (service backend + executor)
and **Node present vs absent** (Node-present → Corepack/pnpm installer; Node-absent
→ auto-selected binary bootstrap, `release-binary-source`).

**Run in waves — do NOT block on the full matrix.** Wave 1's three P0 hosts
surface ~90% of real-host issues; fix those before expanding. Build the
automation runner only *after* Wave 1 passes (automate a proven workflow, don't
debug automation + provisioning + host setup at once).

| # | Host | Service backend | Priority | Node present | Node absent (binary bootstrap) |
|---|------|-----------------|:-:|:-:|:-:|
| 1 | macOS ARM (Apple Silicon) | launchd | **P0** | ☐ | ☐ |
| 3 | Ubuntu 24.04 LTS | systemd --user | **P0** | ☐ | ☐ |
| 6 | Windows 11 (OpenSSH) | schtasks autostart | **P0** | ☐ | ☐ |
| 4 | Debian 12 | systemd --user | P1 | ☐ | ☐ |
| 5 | Fedora 41/42 | systemd --user | P1 | ☐ | ☐ |
| 2 | macOS Intel | launchd | P2 | ☐ | ☐ |

**Wave 1 = the three P0 rows.** Ubuntu's most valuable cell is **Node-absent**
(validates BinaryInstaller + systemd-user + reboot survival in one pass). Windows
is the highest-risk implementation — PowerShell probe, schtasks, binary `.exe`,
OpenSSH all shipped without ever running. For #6 confirm: PowerShell detection
probe, `write-secret`, schtasks registration, and the bun-compiled `.exe` install.

**Wave 2 = P1/P2 rows**, run *after* the automation runner exists.

---

## Per-run: what to capture

1. `detected` ServerPlatform JSON (os, arch, `has('node')`, service manager).
2. The previewed **plan** + which steps required elevation.
3. Per-step outcome from `runProvision`: `ok` / `degraded` / `fatal` + detail.
4. The **HealthReport**: `{ tailnet, agent, detail }`.
5. Anything that needed a manual fix to proceed (these are the real findings).

## Pass criteria (per cell)

Validate **two independent health dimensions** — do not conflate them:

- **Agent Health (authoritative for the install).** SSH to the host and probe the
  agent on loopback: `curl -s http://127.0.0.1:7878/health`. This is the signal
  that the install + service actually worked. A green agent here = the
  provisioning code did its job, *regardless of Tailscale*.
- **Tailnet Health (separate dimension).** `tailscale status` + reachability over
  the tailnet. Only meaningful once Tailscale is up on the host; a fresh VM
  failing this is **not** an install failure.

A cell PASSES when:
- Detection returns the correct OS/arch and Node presence.
- Plan executes with **no `fatal` steps**; rollback not triggered.
- The agent process runs under the OS service manager and **survives a reboot**
  (launchd / systemd-user / schtasks autostart) — re-probe `127.0.0.1:7878/health`
  after reboot.
- **Agent Health is green on loopback.** Tailnet Health is recorded separately and
  does not gate the cell unless Tailscale was deliberately provisioned.

---

## Expected-degraded — do NOT file these as bugs

These steps complete as `degraded` (honest "ok-but-incomplete") **by design**.
Logging them as failures is the #1 expected noise source:

- **egress confinement** — no-op on every OS today; "agent runs without network
  confinement" (`remote-executor.ts:111`).
- **mutagen** — not installed; "the agent will resolve it on first sync" (:99).
- **Tailscale** — not installed; degrades if not already up (:106).
- **Claude CLI** — not installed; operator must `claude /login` on the remote (:127).
- `install-service` on any **unmatched** OS (:92) — should not trigger for the six
  rows above; if it does for a supported OS, that *is* a bug.

A run that completes with only these degraded is a **PASS**.

---

## Known gotcha — `verify` conflates agent + tailnet health

`runVerify` (`verify.ts`) reports `agent` health via a probe the orchestrator wires
**over the tailnet**, and `tailnet` via `tailscale status`. On a fresh VM with no
Tailscale, *both* read as failing — so the built-in HealthReport gives a **false
negative** on the agent even when the install genuinely succeeded.

**For Wave 1 manual validation, treat loopback as the authoritative agent signal:**
SSH to the host and run `curl -s http://127.0.0.1:7878/health` (the agent binds
loopback by default). That isolates "did provisioning work" from "is the tailnet
up." Record the two dimensions in separate columns; never let a missing tailnet
mark an otherwise-healthy agent as FAIL.

If you want the orchestrator's own HealthReport to come back clean end-to-end,
pre-provision Tailscale (`tailscale up`) on the host first — but that's a *second*,
optional check, not a prerequisite for passing the install.

---

## Optional: scriptable runner

The localhost e2e harness (`test/integration/bootstrap.e2e.test.ts`, gated by
`PW_E2E=1` + passwordless `ssh user@127.0.0.1`) is the template. A real-host
variant can take `PW_VALIDATE_HOST` / `PW_VALIDATE_USER`, call `provisionRemote`
against it, and assert no-fatal + expected-degraded-only. This converts rows 3–6
from pure click-through QA into a repeatable check. Build it only if manual passes
first reveal the flow is stable enough to automate.

---

## Findings record (one per cell)

```
Host: <os/arch>  | Node: present|absent  | Tailscale: pre|none  | Date:
detected:      <paste JSON>
plan:          <steps + elevation>
outcome:       <per-step ok/degraded/fatal>
agent health:  <127.0.0.1:7878/health → ok|fail + detail>   ← authoritative
tailnet health:<tailscale status → up|down>                 ← separate dimension
reboot:        <agent re-probed healthy after reboot? yes|no>
manual fixes needed: <none | …>
verdict:       PASS | FAIL — <why>
```

## Done when

**Wave 1 (the gate):** macOS ARM, Ubuntu 24.04, Windows 11 all PASS — agent green on
loopback, no fatal steps, reboot-survival confirmed, findings + fixes recorded.
That's ~90% of real-host risk retired and the trigger to build the `PW_VALIDATE_HOST`
automation runner.

**Wave 2:** Debian 12, Fedora 41/42, macOS Intel — run via the automation runner
once it exists. Provisioning Overhaul v1 closes when the full matrix is green.
