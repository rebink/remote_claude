# M6 — Cost & token tracking (the `$` column in `usage`)

**Date:** 2026-06-07
**Status:** Spec for review. Extends the M1–M5 roadmap (`2026-06-07-research-driven-improvements.md`).

## Problem
`patchwire-agent usage` shows REQ/OK/ASK/CHAT/+LN/-LN/DUR but no token or dollar figures. Two gaps:
1. **Tokens are fake today.** `ai-runner.ts` (streaming/chat path) returns `{ tokensIn: 0, tokensOut: out.length }` — `tokensIn` is always 0 and `tokensOut` is the *character length* of the output, not a real count. The `/ask` path captures no tokens at all. So the existing `tokens_in/tokens_out` audit fields and the `usage` aggregator are built on a placeholder and must be fixed before any cost number is trustworthy.
2. **No cost.** No `$` column; the website governance panel tags COST as roadmap.

## The tariff question (the crux)
The tokens are spent on a **third-party** provider (Claude, GPT, …) whose prices change and vary by model, by cache hit, and by plan. We must NOT hand-maintain a brittle global price list as the primary source. Strategy, in priority order:

1. **Provider-reported cost — preferred, zero tariff maintenance.** The provider's own CLI already computes the dollar cost at current rates:
   - **Claude Code:** `claude -p --output-format json` returns a JSON object with `total_cost_usd` AND a `usage` block (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`), plus `model`/`session_id`/`num_turns`. `--output-format stream-json --verbose` emits the same in a final `result` event. **We read `total_cost_usd` directly — no price table needed.**
   - **Aider:** prints a per-turn `Tokens: N sent, M received. Cost: $X.XX` line we can parse.
   - Record this as `cost_source: "reported"`.
2. **Token × operator price table — fallback only.** For a provider/model that reports tokens but not cost, multiply by an **operator-maintained** rate table in config (NOT hardcoded — rates change), keyed by model:
   ```yaml
   # agent-side pricing.yml (optional)
   models:
     "claude-opus-4-8":   { in_per_mtok: 15.00, out_per_mtok: 75.00, cache_read_per_mtok: 1.50 }
     "gpt-5.2":           { in_per_mtok: 10.00, out_per_mtok: 30.00 }
   ```
   Record as `cost_source: "estimated"` so the table can mark estimates distinctly (e.g. `~$0.12`).
3. **No data → no number.** If neither a reported cost nor tokens+rate are available, show `—`, never a guess.

## The subscription caveat (must be stated, not hidden)
Patchwire's whole premise is **one shared subscription** on the box. If that's a flat-rate plan (Claude Max/Pro), the **marginal** dollar cost of a request is ~0 — you already paid the monthly fee. In that world `total_cost_usd` from Claude is the **API-equivalent** cost (what it *would* cost pay-as-you-go), which is exactly the right number for **fair-share attribution** across the team ("ana drove 48% of the spend-equivalent"), but it is **not a bill you pay twice**. The `usage` output and docs must label the column accordingly (e.g. header `$EQV` or a footnote: "API-equivalent; with a flat-rate plan this is attribution, not incremental spend"). This keeps the claim honest and still useful.

## Design

### Capture (agent side)
- **`/ask`:** switch the agent's invocation to a JSON output format (`PW_AI_ARGS` default becomes `--print --output-format json`, operator-overridable). Parse the JSON to extract: the assistant text (for `stdout`/display), `model`, `usage.*`, and `total_cost_usd`. **Diff capture is unaffected** — the diff comes from `git`, not from the AI's stdout, so changing stdout format is safe. Add a `parseAiUsage(stdout, provider)` pure function with adapters: `claude-json`, `aider-text`, `none`.
- **Chat:** replace the fake `{ tokensIn: 0, tokensOut: out.length }` with real values parsed from the stream-json `result` event (`usage` + `total_cost_usd`).
- Both paths produce a normalized `UsageReport { model?, tokensIn, tokensOut, cacheReadTokens?, cacheCreationTokens?, costUsd?, costSource: 'reported'|'estimated'|'none' }`.

### Pricing fallback (agent side)
- `loadPricing(path?)` reads optional `pricing.yml`; `estimateCost(usage, pricing)` → `{ costUsd, costSource: 'estimated' }` when `costUsd` is absent but tokens + a matching model rate exist. Pure + unit-tested.

### Persist (audit log)
Extend `AskAuditEntry` (and keep `ChatAuditEntry`) with optional: `model?`, `tokens_in`, `tokens_out`, `cache_read_tokens?`, `cost_usd?`, `cost_source?`. Backward compatible (all optional); old lines read fine.

### Aggregate + display (`usage`)
- `aggregateUsage` already sums `tokens_in/out`; add `cost_usd` summation and carry `cost_source` (downgrade the row to `estimated`/mixed if any entry is estimated).
- New columns: `TOK` (in+out, human e.g. `1.2M`) and `$EQV` (sum, `~` prefix when any row is estimated, `—` when no data). Keep within the existing fixed-width table.
- `--json` already emits the full structured report — it gains the new fields automatically.
- Footnote line under the table when costs are shown: the subscription/attribution caveat.

### Website
- `/configuration/`: document `PW_AI_ARGS` JSON default, optional `pricing.yml`. `/roadmap/` + governance panel: move COST from roadmap to shipped, with the API-equivalent footnote. (Via PR per the website workflow.)

## Tasks (TDD)
1. `parseAiUsage` adapters (`claude-json`, `aider-text`, `none`) — pure, table-driven tests incl. malformed/missing fields → `costSource: 'none'`.
2. `loadPricing` + `estimateCost` — pure tests (reported wins over estimate; estimate only when rate present; unknown model → none).
3. Wire `/ask` to JSON output + extract text/usage; assert diff still captured and `stdout` still shows the human text. (Server test, quarantined on CI per existing inject+hijack pattern.)
4. Replace chat runner's placeholder tokens with parsed stream-json usage; update chat audit append.
5. Extend audit entry types + `aggregateUsage` cost summation + provenance downgrade — unit tests.
6. `usage` table: add `TOK`/`$EQV` columns + estimate `~` marker + `—` empty + caveat footnote; snapshot-style test on `row()`/header.
7. Lockstep version bump + CHANGELOG; website PR.

## Out of scope
- Per-request model **selection** / "allowed models" policy (separate; model is server-fixed via `PW_AI_BIN`).
- Real-time budget *enforcement* (cut off a user at $X) — this milestone is visibility only; enforcement can build on `cost_usd` later.

## Honest caveats
- The `$` figure is only as good as the provider's reporting; for fallback-estimated rows it's an approximation tied to an operator table that can go stale (hence the `~` marker + `cost_source`).
- With a flat-rate subscription it is **attribution, not incremental billing** — labeled as such.
- Step 1 (real tokens) is a *correctness fix* to existing data, independent of the dollar column; it can ship first on its own.
