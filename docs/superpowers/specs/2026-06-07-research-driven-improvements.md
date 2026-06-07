# Patchwire research-driven improvements — milestone sequence

**Date:** 2026-06-07
**Origin:** three deep-research rounds (market → differentiators → improvements). Verified findings live in the session; this spec turns the prioritized shortlist into buildable milestones.

## The two defensible cores (what every milestone must strengthen)
1. **Data minimization by construction** — the agent physically only sees synced, non-`.gitignore`d files. (Incumbents like Claude Code default to machine-wide *reads* incl. `~/.aws/credentials`, `~/.ssh/`; `denyRead` is opt-in and leaky.)
2. **Remote-agent + diff-back-to-LOCAL workflow** — dev runs/hot-reloads locally while the agent runs remote.

## Milestone sequence (highest leverage + most tractable first)

### M1 — Reliable 3-way apply + drift detection  ← THIS MILESTONE
**Pain (real, daily):** the diff is generated on the remote against the *synced* snapshot. Locally, `applyPatchInteractive` runs plain `git apply` (no `--3way`). If the local tree moved since sync, apply fails outright → user is dumped into save/selective with no explanation.
**Build:**
- Parse each file chunk's pre-image blob SHA from its `index <pre>..<post>` line.
- `detectDrift(diff, cwd)` — for each modified file, compare `git hash-object <localfile>` to `<pre>`; return the list of files that changed locally since the agent's snapshot (plus files now missing locally).
- `gitApply3way(diff, cwd)` — `git apply --3way`; when context doesn't match, git 3-way-merges using the pre-image blobs (which exist locally because it's the same project), succeeding where plain apply fails and inserting conflict markers only where local + AI touched the same lines. Detect + report conflicted files.
- UX: strict `--check` first → if clean, "Apply all (clean)". If not, show `⚠ local drifted since sync: <files>` and offer "Apply with 3-way merge" (warn it may add conflict markers; list them after).
**Differentiating?** Yes — directly de-risks the unique diff-back-to-local step. No remote box needed; fully testable in-repo.

### M2 — Test-before-return on the remote
**Pain (real, documented):** AI diffs need human review; reviewer bandwidth is in crisis (Meta: +106% LOC/diff YoY, >80% agentic). Returning an *unvalidated* diff makes every review start from zero.
**Build:** optional `verify` command in `patchwire.yml` (e.g. `flutter analyze`, `npm test`). After the agent captures the diff on its clean checkout, run `verify` there; attach `{passed, summary}` to the `/ask` response. CLI/extension shows "diff + ✅ tests passed" or "⚠ tests failed" before the human reviews. Deterministic, low-noise (research: chatty LLM review hurts adoption; the *measurable* safety gain from AI risk-scoring was refuted — so prefer real test runs).
**Differentiating?** Yes — natural Patchwire advantage: the clean checkout is already on the remote.

### M3 — Default-deny egress on the remote
**Pain (real):** read-minimization stops the agent *seeing* un-synced secrets, but says nothing about *exfiltration* of synced code (or prompt-injection). Egress lockdown makes "the agent can't leak your code" structurally true — the other half of the moat.
**Build:** `patchwire-agent install` option to run the agent (and the `claude` subprocess) in a network namespace with **default-deny** outbound, allowlisting only what's needed (Anthropic API + package registries). **Lesson from research:** allowlist suffix-matching is a proven footgun (Claude Code SOCKS5 null-byte bypass, live 5.5 months) — prefer default-deny + a single vetted resolver path over clever allowlist parsing. Platform-specific (Linux netns first; macOS later).
**Differentiating?** Yes — completes the sealed-box claim. Caveat: harder to test in-repo (needs a real remote/OS).

### M4 — Secret-scan before sync
**Pain (partial):** `.gitignore` protects *ignored* files, but a secret committed into a *tracked* file still crosses. Pre-sync scan (gitleaks) blocks/warns.
**Build:** optional pre-sync hook in `patchwire sync` / `ask` — run `gitleaks detect` (or `trufflehog`) over the about-to-sync fileset; on findings, refuse to sync (or `--force`) and report. Research caveat: unverified how much this adds beyond gitignore-sync — keep it cheap and optional, don't over-invest.
**Differentiating?** No (table-stakes hygiene) — but cheap and reinforces the security story.

### M5 — Per-session ephemeral isolation + access manifest
**Pain:** "the agent only saw what you shared" is currently a claim, not an artifact.
**Build:** fresh per-session workspace; after each run, emit a manifest of exactly which files the agent read/wrote (from the audit pipeline). Turns trust into an auditable record.
**Differentiating?** Yes — provability. Pairs with M3.

### Explicitly deferred (table-stakes, integrate don't invent)
- **Build-cache sharing** (Gradle/Bazel/Depot remote cache) — real (up to 10×) but adjacent to the cores; integrate later if builds hurt.

## Cross-cutting
- Website (`/security/`, `/roadmap/`) updated as each ships, via PR (per team workflow).
- Each milestone: TDD, lockstep CLI+extension version bump when the surface changes, CHANGELOG entry.
