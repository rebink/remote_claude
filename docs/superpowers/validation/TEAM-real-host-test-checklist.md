# Real-host provisioning — team test checklist

**Status as of 2026-06-13:** macOS ARM is the only OS validated on real hardware. Linux & Windows
are **static-hardened only** (fixes derived by porting confirmed macOS bugs to shared/analogous
code, unit-tested at the string level, but **never run on a real host**). This doc is what your
team should run on real Linux/Windows machines post-release, and what to expect.

Provisioning entry point: `patchwire setup --provision-remote --host <ip> --user <u>`.
Flow: **detect → plan → preview → consent → execute → verify**.

---

## The 5 bug classes to watch (found + fixed on macOS — verify they don't recur per-OS)

These came from the macOS real-host run (PR #55). Use them as a lens on every host:

1. **Non-interactive SSH PATH** — `ssh host 'cmd'` runs with a minimal PATH (no `~/.zprofile`/`~/.bashrc`). Tools installed outside `/usr/bin` (Homebrew, nvm, pnpm) vanish. Detection said "Node absent" when it wasn't.
2. **corepack assumption** — bootstrap assumed `corepack`; it's unbundled on newer Node. Now: existing pnpm → corepack (no npm, per policy).
3. **Shell-statement form** — a `PATH=… cmd` assignment-prefix is invalid before `if`/compound commands and only applies to the first command in a chain. Prefix is now a real `export …;` statement.
4. **pnpm global bin dir** — `pnpm add -g` fails (`ERR_PNPM_NO_GLOBAL_BIN_DIR`) without `PNPM_HOME`. Now set explicitly.
5. **Service can't find the binary** — the install/autostart referenced the agent by bare name, but it lives off-PATH (`$PNPM_HOME` on POSIX, `%USERPROFILE%\.patchwire\bin` on Windows). Now resolved to absolute/known paths.

---

## macOS — ✅ VALIDATED (arm64, macOS 26)
Dry run + execute both passed; agent healthy (`/health` 200), launchd `RunAtLoad`+`KeepAlive`.
See `2026-06-13-macos-arm-wave1.md`. Still to verify by the team:
- [ ] **macOS Intel** (x64) — never run; same code path, different arch.
- [ ] **Actual reboot** survival (we only confirmed `RunAtLoad`, didn't hard-reboot).
- [ ] **Node-absent macOS** — exercises the binary-bootstrap (`binarySource`) instead of pnpm; needs a release artifact.
- [ ] ⚠️ **Keychain auto-lock regression (FINDING):** install runs "login keychain auto-lock disabled" and `patchwire-agent uninstall` does **not** restore it. Verify + decide whether uninstall should re-enable lock-on-sleep. Restore manually: `security set-keychain-settings -l ~/Library/Keychains/login.keychain-db`.

## Linux — 🟡 STATIC-HARDENED, unverified
Shares the POSIX path with macOS, so it inherits the bug-class fixes. `systemd --user` install
+ `loginctl enable-linger`. Verify on real Ubuntu 24.04 / Debian 12 / Fedora 41+:
- [ ] **Detection** — correct os/arch + `node.present`. Note: PATH prefix now covers `/opt/homebrew/bin`, `/home/linuxbrew/.linuxbrew/bin`, `/usr/local/bin`, `~/.local/bin`. apt/NodeSource Node (`/usr/bin`) is on the default PATH ✓.
- [ ] ⚠️ **nvm/fnm Node is NOT covered** (versioned paths like `~/.nvm/versions/node/*/bin`). A box whose only Node is nvm will detect Node-absent. Known gap — document or extend if it bites.
- [ ] **bootstrap-agent** — pnpm install with `PNPM_HOME` set; agent lands in `$PNPM_HOME`.
- [ ] **install-service** — `systemd --user` unit; `bash -lc 'patchwire-agent install'` finds the binary (PNPM_HOME-prefixed).
- [ ] **enable-linger** — agent survives logout AND **reboot** (linger needs polkit/root on some distros — may degrade).
- [ ] **Agent health** — `curl 127.0.0.1:7878/health` on the box (authoritative; independent of tailnet).
- [ ] **Node-absent + binary bootstrap** — the high-value Linux cell; needs the release `.bin` artifact.

## Windows — 🔴 HIGHEST RISK, static-hardened, unverified
PowerShell over OpenSSH; `schtasks` autostart; standalone `.exe` (no pnpm). The static audit found
+ fixed the BUG-5 class **twice** here (W1/W2/W3 in PR for this doc) — but nothing has run. Verify on real Windows 11 / Server w/ OpenSSH:
- [ ] **Detection** — PowerShell probe fallback returns correct os/arch (`uname` fails → PS path).
- [ ] **bootstrap-agent** — binary installs to `%USERPROFILE%\.patchwire\bin\patchwire-agent.exe`, sha256 verified.
- [ ] **install-service (FIX W1)** — `patchwire-agent install` now invoked via the **absolute .exe path** (was bare name → would've failed). Confirm the schtasks task registers.
- [ ] **autostart launcher (FIX W2)** — launcher calls the **absolute .exe path** for `serve` (was bare name). Confirm the agent actually starts.
- [ ] ⚠️ **schtasks `/SC ONLOGON`** runs at **user logon, not boot** (chosen to avoid admin). On a headless server the agent won't start until someone logs in. Decide if that's acceptable or needs a service/`ONSTART` (admin).
- [ ] **PowerShell quoting** — every PS command is single-quote/`Join-Path`-based; verify nothing breaks under the real OpenSSH default shell (cmd vs PowerShell as `DefaultShell`).
- [ ] **Agent health** — reachable on `127.0.0.1:7878`.
- [ ] **bun-windows-arm64** — not built (only x64). ARM Windows unsupported for now.

---

## Expected-degraded on ANY host (NOT bugs — don't file them)
- **bind-tailnet** — degraded if Tailscale isn't `up` on the host (the agent is then only reachable on loopback/LAN).
- **install-mutagen / install-claude** — degraded if those tools are absent; the agent resolves mutagen on first sync, and Claude needs a manual `claude /login` on the remote.
- **apply-egress** — enforced via seatbelt on macOS; on Linux egress confinement is currently a warn/no-op.

## Verify methodology reminder
Treat **`curl 127.0.0.1:7878/health` on the host** as the authoritative "did provisioning work"
signal. The built-in `verify` HealthReport probes the agent **over the tailnet**, so on a host
without Tailscale it reports a false-negative even when the agent is healthy. Record agent-health
and tailnet-health as separate columns.
