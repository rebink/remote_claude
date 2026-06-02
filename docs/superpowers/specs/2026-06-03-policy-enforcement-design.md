# Milestone 2 — Per-user policy enforcement (project allowlist + rate limit)

**Date:** 2026-06-03
**Status:** Approved design, ready for plan
**Part of:** production-readiness sequence (milestone 2 of 4). Prev: `patchwire-agent usage` (done). Next: release hardening → device bridge.

---

## Decisions (from brainstorm)
1. **Enforce two controls:** per-user **project/repo allowlist** and per-user **rate limit** (max requests per rolling window). **"Allowed models" is deferred** — the model is server-fixed (`PW_AI_BIN`/`PW_AI_ARGS`); a request can't pick one, so there's nothing to gate until per-request model selection exists. Recorded as future work.
2. **Storage + config:** per-user `policy` object inside `users.json`, set via new `patchwire-agent user policy …` subcommands. (No global defaults this milestone — per-user only; global defaults are future work.)

## Architecture

### Pure policy module — `agent/policy.ts` (no I/O)
```ts
interface RateLimit { max: number; windowMs: number }
interface UserPolicy { projects?: string[]; rateLimit?: RateLimit }
interface PolicyContext { project: string; recentCount: number }
type PolicyDecision = { allowed: true } | { allowed: false; code: string; message: string }
function evaluatePolicy(policy: UserPolicy, ctx: PolicyContext): PolicyDecision
```
Rules, in order: if `projects` is non-empty and `ctx.project` not in it → deny `project_not_allowed`; else if `rateLimit` and `recentCount >= rateLimit.max` → deny `rate_limited`; else allow. `UserPolicy`/`RateLimit` are the single source of truth for the shape and are imported by `users-store.ts`.

### Duration helper — `lib/duration.ts`
`parseDurationMs('30s'|'15m'|'6h'|'7d') → ms` (throws on bad input). `commands/agent-log.ts`'s existing `parseSince` is refactored to `Date.now() - parseDurationMs(v)` (DRY; behaviour unchanged — no test asserts its error string).

### Storage — `agent/users-store.ts`
- `UserRecord` gains `policy?: UserPolicy`.
- `getPolicy(name): UserPolicy` → the record's policy or `{}`.
- `setProjects(name, string[] | null)` and `setRateLimit(name, RateLimit | null)` — mutate + persist; an empty policy normalizes to `undefined` (not persisted as `{}`).

### Config CLI — `commands/user.ts` (nested under `user`)
- `user policy show <name>` — print allowlist + rate limit (or "(all allowed)" / "(unlimited)").
- `user policy projects <name> [projects...] [--clear]` — set/clear the allowlist.
- `user policy rate <name> [max] [window] [--clear]` — e.g. `rate ana 50 1h`; `--clear` removes it. Validates `max` (positive int) and `window` (via `parseDurationMs`).

### Enforcement — `agent/server.ts`
In both `/ask` and `/chat`, immediately after `req.username` is resolved and **before** any filesystem check or `reply.hijack()`:
```ts
const policy = opts.usersStore.getPolicy(username);
const recentCount = policy.rateLimit
  ? countRecentRequests(opts.auditLog, username, policy.rateLimit.windowMs)
  : 0;
const decision = evaluatePolicy(policy, { project, recentCount });
if (!decision.allowed) { /* 403 with { error|code: decision.code, message } */ }
```
`countRecentRequests(auditLog, user, windowMs)` = `auditLog.readAll().filter(e => e.user===user && Date.parse(e.ts) >= Date.now()-windowMs).length`. Counting completed turns (the audit log records successful turns) is acceptable for cost control at single-team scale; documented. Denials return before hijack → clean JSON 403 (`/ask`: `{error, message}`; `/chat`: `{ok:false, code, message}`).

## Out of scope
- Allowed-models gating (needs per-request model selection — future).
- Global/default policies (per-user only this milestone).
- Counting in-flight/failed requests toward the rate limit (only audited completions count).
- Exposing policy via HTTP / the website.

## Success criteria
- `evaluatePolicy` unit-tested (allow, project deny, rate deny, both-pass, empty-policy).
- `UsersStore` policy get/set persists and round-trips; empty policy not stored as `{}`.
- `user policy show/projects/rate` commands work, with validation.
- `/ask` returns 403 `project_not_allowed` for a disallowed project and 403 `rate_limited` when over the window count; an allowed request passes policy (proceeds to the normal fs checks). `/chat` enforces symmetrically.
- `pnpm --filter patchwire test/typecheck/build` green; existing tests unaffected.

## Affected files
- Create: `packages/cli/src/agent/policy.ts`, `packages/cli/src/lib/duration.ts`, `packages/cli/test/agent/policy.test.ts`, `packages/cli/test/agent/users-policy.test.ts`, `packages/cli/test/commands/user-policy.test.ts`, `packages/cli/test/agent/policy-enforcement.test.ts`
- Modify: `packages/cli/src/agent/users-store.ts`, `packages/cli/src/commands/agent-log.ts` (parseSince → parseDurationMs), `packages/cli/src/commands/user.ts`, `packages/cli/src/agent/server.ts`
