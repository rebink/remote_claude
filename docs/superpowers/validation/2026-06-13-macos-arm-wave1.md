# Wave 1 validation — macOS ARM (dry run)

**Date:** 2026-06-13 · **Host:** this dev MacBook · **Mode:** DRY RUN (detect→plan→preview, consent declined, zero mutation)

```
Host:           macOS 26.5.1, arm64 (Darwin 25.5.0)
Target:         127.0.0.1 via SSH (dedicated key ~/.ssh/pw_validate)
Node on host:   present (Homebrew, v25.9.0 at /opt/homebrew/bin/node)
Mutation:       NONE — provisionRemote returned status=cancelled, outcome=undefined
Harness:        packages/cli/scripts/validate-dryrun.ts
```

## PASS

- **Dry-run mechanism** — `confirm: () => false` cancels cleanly at the consent gate;
  `status=cancelled`, `outcome` never created. Confirms we can validate detect+plan on
  real hardware with zero side effects.
- **OS / arch detection** — `os=macos, arch=arm64, pathStyle=posix`. Correct.
- **Capability → backend mapping** — all correct for macOS:
  service=launchd (no elevation), secrets=keychain, egress/filesystemIsolation=seatbelt,
  shell=zsh.
- **Plan ordering** — `bootstrap-agent` emitted **first** (the #50 fix holds), then
  install-claude → install-mutagen → write-secret → install-service → apply-egress →
  bind-tailnet. Elevation required: **none** (correct — macOS is fully user-level launchd).

## FAIL / BUGS

### BUG-1 (P0) — Homebrew tools invisible to detection; Node reported absent — ✅ FIXED & VERIFIED (2026-06-13)
**Resolution:** added shared `POSIX_PATH_PREFIX` (`PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"`)
in `primitives.ts`; prepended to `buildProbeScript()` (POSIX probe) and the POSIX execute
commands that invoke external tools (`AGENT_INSTALL_CMD`, `install-mutagen`, `install-claude`,
`bind-tailnet`). Left untouched: builtin-only commands (`WRITE_AGENT_ENV_CMD`, egress set/unset),
`install-service` (already runs `bash -lc`), and all Windows builders. Tests: 130 passed, tsc clean.
**Re-run dry run confirms:** `node.present: true`, `packageManager: brew` (was `manual`), plan/elevation
unchanged, still cancels with zero mutation.

#### Original report
`detected.node.present = false` and `packageManager = manual`, **despite** Node v25.9.0
and Homebrew both being installed.

- **Root cause:** `buildProbeScript` (`remote-detect.ts:14`) runs
  `uname -sm; for c in …; do command -v "$c" …` over a **non-interactive** SSH command
  session. That PATH is `/usr/bin:/bin:/usr/sbin:/sbin` — it does **not** source
  `~/.zprofile`/`~/.zshrc`, so `/opt/homebrew/bin` is absent. Every Homebrew-installed
  probe tool (node, brew, pnpm, corepack, mutagen, secret-tool) reads as missing.
  A login shell (`ssh host 'zsh -lc "command -v node"'`) finds them fine.
- **Evidence:** non-interactive `echo $PATH` → `/usr/bin:/bin:/usr/sbin:/sbin`;
  `command -v node` → not found; `zsh -lc` → `/opt/homebrew/bin/node`.
- **Impact:** On any macOS host with Homebrew Node, detection wrongly says Node-absent.
  Worse, this is **not just a detection cosmetic** — the *execute* phase runs its commands
  over the same non-interactive PATH, so `AGENT_INSTALL_CMD` (corepack/pnpm) and any
  brew-based step would **fail or degrade at run time too**. A real execute on this Mac
  would very likely have failed. The dry run caught it first.
- **Suggested fix (holistic — not detection-only):** every provisioning SSH command should
  run with an augmented PATH. Cheapest: prepend
  `PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"` to the probe script and
  to the command builders in `installer.ts`/`primitives.ts`/`remote-executor.ts`. Or run
  remote commands through a login shell (`zsh -lc` / `bash -lc`) — heavier, and quoting-risky.
  Prefer the explicit PATH prefix. Add a unit test: probe script must find a tool that only
  exists under `/opt/homebrew/bin`.

## Notes / expected-degraded
- Not reached — consent declined before execute, so no degraded steps to assess this run.
  The degraded matrix (egress/mutagen/tailscale/claude-CLI) gets validated in a real execute.

## Machine state left behind (cleanup)
- `~/.ssh/pw_validate{,.pub}` — dedicated unencrypted validation key (ed25519).
- `~/.ssh/authorized_keys` — gained `pw_validate.pub` and (redundantly) `id_rsa.pub`.
- No launchd service, no agent, no `~/.patchwire` change. Reversible: remove the two
  authorized_keys lines + delete the keypair.

## Next
- Decide: fix BUG-1 (PATH) before the macOS *execute* pass, since execute would hit the
  same root cause. Then re-run dry → execute on macOS, and carry the same PATH check into
  the Ubuntu/Windows runs (Linux Homebrew / nvm / fnm have the same shape).
