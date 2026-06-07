# M3 — Default-deny egress on the remote (macOS / seatbelt)

**Date:** 2026-06-08
**Status:** Approved design (platform + mechanism + allowlist confirmed with the user). Supersedes the Linux-netns sketch in `2026-06-07-research-driven-improvements.md` (M3).

## Decisions (confirmed)
- **Target:** macOS Mac Mini only (the agent installer is macOS-only; Linux is out of scope for M3 v1).
- **Mechanism:** wrap the `claude` spawn in `sandbox-exec` (seatbelt) with a generated network policy. Per-process, no root, no dedicated user, no system-wide firewall — matches what Claude Code's own macOS sandbox does.
- **Allowlist default:** default-deny all outbound except the Anthropic API (+ operator-added hosts). Builds/runs happen locally in Patchwire's model, so the remote agent rarely needs anything else.

## Why this matters
Read-minimization (the sync model) stops the agent *seeing* un-synced secrets. It says nothing about *exfiltration* of synced code, or a prompt-injected agent phoning out. Egress lockdown makes "the agent can't leak your code" structurally true — the second half of the sealed box.

## Design

### Policy (seatbelt profile)
Allow everything except outbound network; then re-allow only localhost, DNS, and the resolved allowlist IPs. Filesystem is intentionally left open (that's the sync model's job, not M3).

```
(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
(allow network-outbound (remote unix-socket))
(allow network-outbound (remote ip "*:53"))            ; DNS — see caveat
(allow network-outbound (remote ip "<ip>:443"))        ; one per resolved allowlist IP
...
```

### Module `packages/cli/src/agent/egress.ts`
- `ANTHROPIC_DEFAULT_HOSTS: string[]` — `['api.anthropic.com']` (+ auth host if needed; confirmed on box).
- `mergeAllowHosts(extra: string): string[]` — default hosts ∪ comma/space-split operator hosts, deduped.
- `resolveHosts(hosts): Promise<string[]>` — DNS-resolve to a deduped IP list (node:dns). Thin; the merge/dedup is the unit-tested part.
- `buildSeatbeltProfile(opts: { allowIps: string[]; allowDns: boolean }): string` — pure profile generator.
- `wrapWithEgress(command, args, profilePath): { command: 'sandbox-exec', args: ['-f', profilePath, command, ...args] }` — pure.
- `egressAvailable(): boolean` — `sandbox-exec` on PATH (fail-closed input).

### Config (agent.ts)
- `PW_EGRESS` = `off` (default) | `deny`.
- `PW_EGRESS_ALLOW` = extra hosts (comma/space separated).
- `PW_EGRESS_ALLOW_DNS` = `1` (default) | `0` (tightest; only works if claude connects by pinned IP).

### Startup + wiring
1. On `serve`, if `PW_EGRESS=deny`: **fail-closed** — if `sandbox-exec` is missing, refuse to start with a clear error (don't silently run open).
2. Resolve `mergeAllowHosts(PW_EGRESS_ALLOW)` → IPs; `buildSeatbeltProfile` → write to `~/.patchwire/egress.sb` (0600). Pass the profile path to `buildServer` → both spawn sites (`runAi` for `/ask`, `makeAiRunner` for chat) wrap via `wrapWithEgress`.
3. **Re-resolution:** Anthropic is behind a CDN; IPs churn. v1 resolves at startup; regenerate on a timer (e.g. every 30 min) — covers the common case; full robustness verified on the box. (Follow-up: refresh-on-profile-miss.)

### Doctor probe (`patchwire-agent` side)
A check that runs a tiny probe **under the profile** (e.g. `sandbox-exec -f egress.sb curl -m3 https://example.com` must FAIL, and a probe to the Anthropic host must SUCCEED). This is the on-box proof that enforcement works.

## Honest caveats (verify on the Mac Mini)
- **IP, not hostname.** macOS egress matches on IP; the allowlist is resolved IPs, re-resolved on a timer. NO hostname-suffix matching (that's the exact footgun behind Claude Code's 5.5-month SOCKS5 null-byte bypass).
- **DNS allowed by default** (port 53) so claude can resolve. This leaves a narrow DNS-tunneling vector; `PW_EGRESS_ALLOW_DNS=0` closes it but then claude must reach pinned IPs only. Decide on the box.
- **`sandbox-exec` is deprecated-but-functional.** Apple still ships it; Claude Code uses it. If Apple removes it, fall back to the pf+uid mechanism (the runner-up option) — the egress module's wrapper boundary makes that swap localized.
- **Enforcement is unverifiable in CI/this repo.** In-repo we unit-test profile generation, allowlist merge, wrapper construction, and fail-closed logic. The *actual* deny is proven by the doctor probe on the Mac Mini.

## What's built in this milestone vs at the box
- **In-repo, TDD:** `buildSeatbeltProfile`, `mergeAllowHosts`, `wrapWithEgress`, `egressAvailable`, config parsing, fail-closed decision, doctor-probe command construction.
- **At the Mac Mini (you):** run `patchwire-agent doctor` egress probe to confirm a blocked host fails and Anthropic succeeds; tune DNS/IP-refresh.

## Success criteria
- `PW_EGRESS=deny` makes `/ask` and chat spawn `claude` via `sandbox-exec -f <profile>`.
- Profile denies outbound by default, allows localhost + DNS + each resolved allowlist IP.
- Missing `sandbox-exec` under `deny` → agent refuses to start (fail-closed).
- Default `PW_EGRESS=off` → spawn is byte-for-byte unchanged (no regression).
- Doctor probe reports blocked vs allowed correctly on the box.

## Out of scope (follow-ups)
- Linux (netns) backend. pf+uid backend. Refresh-on-miss IP strategy. Filtering DNS itself (only the on/off toggle here).
