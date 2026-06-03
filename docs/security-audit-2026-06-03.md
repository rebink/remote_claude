# Patchwire security audit — 2026-06-03

Threat model: single team, self-hosted on a trusted private network (Tailscale/LAN).
Primary risks: accidental exposure of the HTTP port to a wider network, and
information disclosure to authenticated-but-curious users.

## Fixed in v0.3.0
- **F1 (High) — install bound to 0.0.0.0.** `patchwire-agent install` defaulted the
  launchd host to `0.0.0.0`, more permissive than `serve` (`127.0.0.1`). Now defaults
  to `127.0.0.1`; reachability is opt-in via `--host`/`PW_AGENT_HOST`.
- **F2 (High) — `/health` disclosed the AI binary's absolute path** unauthenticated.
  Now returns only `{ found }`.
- **F3 (Medium) — `/ask` and `/chat` 404s disclosed the absolute project path.**
  Now path-free.
- **F7 (Low) — launchd plist written without an explicit mode.** Now `0600`.

## Accepted decisions (not changed)
- **F4 — token hashing is plain SHA-256 (no KDF/salt).** Acceptable: tokens are
  256-bit random (`generateToken`), so SHA-256 is preimage-infeasible and avoids
  per-request KDF latency. Documented inline in `token.ts`.
- **F5 — SSH uses `StrictHostKeyChecking=accept-new` (TOFU).** Acceptable under the
  Tailscale trust model (stable, control-plane-authenticated hosts). Harden to
  `StrictHostKeyChecking=yes` with a pinned `known_hosts` if running off-Tailscale.
- **F6 — `postinstall` vendors `sshpass` without checksum verification.** Acceptable
  for a self-installed dev tool; a pinned-checksum download is future work. The
  `|| true` also hides install failures — revisit.

## Confirmed correct (no action)
- **F8** — legacy `verifyToken` is dead code (server uses hashed `lookupByToken`).
- **F9** — prompts are stored only as `prompt_sha256`; no tokens/prompts are logged.
- **F10** — `/ask` + `/chat` path-traversal defense (`resolve` + `startsWith(root+sep)`
  plus the project-name regex) is correct.
