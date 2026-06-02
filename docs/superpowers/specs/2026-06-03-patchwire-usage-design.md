# Milestone 1 — `patchwire-agent usage` (per-user usage report)

**Date:** 2026-06-03
**Status:** Approved design, ready for plan
**Part of:** production-readiness sequence (milestone 1 of 4). Next: policy enforcement → release hardening → device bridge.

---

## Decision

Add an admin command that summarizes per-user activity from the existing audit log. Two product decisions locked in brainstorming:

1. **Usage now, dollar cost later.** Aggregate only data the audit log already records. **No dollar `$` cost** — the log has no `model` field and no reliable token counts for `/ask` (only `/chat` records tokens). Real cost is a later milestone (record model + true tokens + pricing table).
2. **Local admin CLI.** Mirror the existing `patchwire-agent log` command: read the local `~/.patchwire/agent.log` on the agent host, run by an admin there. No new network surface, no new HTTP endpoint.

Command name: **`patchwire-agent usage`** (the website mock said `patchwire usage` loosely; the real command is agent-side because the log lives on the agent host).

## What the audit log already gives us (`AuditEntry`)
- Base: `ts, user, project, prompt_sha256, duration_ms, queue_wait_ms`
- `/ask`: `files, lines_added, lines_removed, exit_code`
- `/chat`: `uuid, tokens_in, tokens_out`

Reader `readEntries()` (in `agent/log-reader.ts`) already handles rotation, malformed lines, and `{user, project, sinceMs}` filtering. We reuse it.

## Behaviour

`patchwire-agent usage [--user <name>] [--project <name>] [--since <dur>] [--json]`

- Reads all matching entries (no `limit`), aggregates per user, prints a table sorted by request count (desc), then a totals row.
- `--since` accepts the same `30s|15m|6h|7d` grammar as `patchwire-agent log` (the `parseSince` helper is reused).
- `--json` emits the structured `UsageReport` instead of the table.
- Empty result prints `(no usage yet)`.

### Per-user aggregation (`UserUsage`)
| field | meaning |
|---|---|
| `user` | username |
| `requests` | total entries |
| `accepted` | `/ask` with `exit_code === 0`; every `/chat` counts as accepted (no exit code) |
| `ask` / `chat` | per-route counts |
| `lines_added` / `lines_removed` | summed over `/ask` |
| `files` | summed over `/ask` |
| `duration_ms` / `queue_wait_ms` | summed over all entries |
| `tokens_in` / `tokens_out` | summed over `/chat` |

`UsageReport = { users: UserUsage[]; totals: UserUsage (user:"total") }`. `users` sorted by `requests` desc, then `user` asc.

### Table columns (default render)
`USER  REQ  OK  ASK  CHAT  +LN  −LN  DUR`
- Numbers right-aligned; `DUR` shows summed duration humanized (`humanizeMs`: `<60s → "45s"`, else `"2m 3s"`, else `"1h 2m"`).
- `tokens_in/out` and `queue_wait_ms` are omitted from the table (mostly zero / noisy) but present in `--json`.
- A divider line, then the `total` row.

## Architecture / units
- **`agent/usage.ts`** — pure functions only: `aggregateUsage(entries): UsageReport` and `humanizeMs(ms): string`. No I/O. Independently unit-tested.
- **`commands/usage.ts`** — `registerUsageCommand(program)`: option parsing, calls `readEntries` + `aggregateUsage`, renders. Mirrors `commands/agent-log.ts`.
- **`commands/agent-log.ts`** — add `export` to its existing `parseSince` so `usage.ts` reuses it (DRY; behaviour unchanged).
- **`agent.ts`** — register the command next to `registerAgentLogCommand(program)`.

## Out of scope
- Dollar cost, model recording, token-accuracy work (later milestone).
- HTTP `/usage` endpoint, laptop-side `patchwire usage`, website changes.
- Date-bucketing / charts. Just per-user totals over the (optionally `--since`-filtered) window.

## Success criteria
- `patchwire-agent usage` prints a correct per-user table + totals; `--user/--project/--since/--json` all work; empty → `(no usage yet)`.
- `aggregateUsage` and `humanizeMs` have unit tests; the command has tests modeled on `agent-log.test.ts`.
- No fabricated dollar figures anywhere.
- `pnpm --filter patchwire test`, `typecheck`, and `build` all green; existing tests unaffected.

## Affected files
- Create: `packages/cli/src/agent/usage.ts`, `packages/cli/src/commands/usage.ts`, `packages/cli/test/agent/usage.test.ts`, `packages/cli/test/commands/usage.test.ts`
- Modify: `packages/cli/src/commands/agent-log.ts` (export `parseSince`), `packages/cli/src/agent.ts` (register command)
