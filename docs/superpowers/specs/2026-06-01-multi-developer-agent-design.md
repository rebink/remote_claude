# Multi-developer agent — design spec

- **Date:** 2026-06-01
- **Status:** Draft, awaiting user review
- **Scope:** Patchwire v0.2 → v0.3 (multi-user support + admin panel)
- **Author:** Brainstormed with Claude Code

## 1. Context

Patchwire v0.1 ships a single-user agent: one bearer token, one project root,
one working tree per project. The motivating user (a Flutter team) wants to
share one agent box across N developers without giving up the working-tree
contract, the diff-review gate, or the "no remote command execution"
security posture.

This spec defines the smallest set of changes that turns the agent into a
team-friendly service while preserving today's design principles:

1. Local stays local.
2. Reviewable changes only.
3. Boring transport (HTTP + rsync).
4. Defense in depth.
5. Fail safe.

It also adds a read-only admin panel for observability into usage, queue
state, and audit logs.

## 2. Goals

- Multiple developers share one agent box, isolated per-user on disk.
- Each developer authenticates with a unique bearer token.
- Concurrent requests are bounded and fairly capped per user.
- Every request is recorded in a structured audit log.
- An admin can observe users, usage, queue state, and logs through a
  browser-based panel served by the agent itself.
- Existing v0.1 installs auto-migrate; single-developer setups continue to
  work with no extra steps.

## 3. Non-goals

- ❌ Admin mutations over HTTP. User add/remove/rotate stay in local CLI.
  The panel is read-only forever.
- ❌ Shared project trees with merge semantics. Per-user clones are the model.
- ❌ Cross-user visibility (Alice cannot see Bob's projects, logs, or queue).
- ❌ Per-user resource quotas (disk, Claude minutes). Observability first;
  enforcement is a v0.4 question.
- ❌ Notifications (email / Slack / webhooks) on long-run completion.
- ❌ SSO / OAuth / SAML. Bearer tokens only.
- ❌ Multi-tenant hostile-user threat model. Single team, trusted users.
- ❌ Live co-editing or shared sessions. Request/response only.

## 4. Architecture

### 4.1 Filesystem layout on the agent

```
PW_PROJECTS_ROOT/
  alice/
    flutter-app/        ← Alice's clone, her rsync target
    backend/
  bob/
    flutter-app/        ← Bob's clone, his rsync target
```

Each user gets a namespace directory under `PW_PROJECTS_ROOT`. rsync paths
and the agent's project-resolution logic both gain a `<user>` segment. The
existing project-name regex `[a-zA-Z0-9_.-]+` is reused for usernames; this
prevents path traversal at the API boundary.

Concretely, project resolution is:

```ts
const userRoot   = path.join(PW_PROJECTS_ROOT, validUsername(authedUser));
const projectDir = path.join(userRoot, validProject(req.body.project));
assert(projectDir.startsWith(userRoot + path.sep)); // defense in depth
```

### 4.2 Identity store

New file `~/.patchwire/users.json` on the agent host:

```json
{
  "alice": {
    "token_hash": "sha256:…",
    "created_at": "2026-06-01T10:00:00Z",
    "disabled": false,
    "last_seen": "2026-06-01T12:00:00Z"
  },
  "bob":   { "token_hash": "sha256:…", "created_at": "…", "disabled": false },
  "__admin__": { "token_hash": "sha256:…", "created_at": "…" }
}
```

Tokens are never stored plaintext on the agent — only the SHA-256 hash.
Constant-time compare on lookup (same primitive as today's single token).
The `__admin__` reserved key holds the admin panel's token.

### 4.3 Concurrency primitive

A single in-memory semaphore on the agent:

- `Semaphore(N_total)` global cap (default: 3)
- `Map<user, Semaphore(N_per_user)>` per-user cap (default: 1)

FIFO wait on both. No external dependency (no Redis, no DB). Queue state is
in-memory and rebuilt on agent restart; in-flight requests fail with `503
agent_restart` and the CLI surfaces this clearly.

### 4.4 Audit log

JSONL at `~/.patchwire/agent.log`, one line per request:

```json
{
  "ts":             "2026-06-01T12:00:00Z",
  "user":           "alice",
  "project":        "flutter-app",
  "prompt_sha256":  "…",
  "files":          7,
  "lines_added":    120,
  "lines_removed":  15,
  "duration_ms":    42100,
  "queue_wait_ms":  3400,
  "exit_code":      0
}
```

No plaintext prompts. Rotated by size (default 50MB) with `.1`, `.2`, ... tail.

## 5. Components

### 5.1 New agent CLI subcommands

| Command | Purpose |
|---|---|
| `patchwire-agent user add <name>` | Generate a 256-bit token, print once, store hash |
| `patchwire-agent user list` | Show users + status |
| `patchwire-agent user disable <name>` / `enable <name>` / `rm <name>` | Lifecycle |
| `patchwire-agent user rotate <name>` | New token, old dies immediately |
| `patchwire-agent admin init` | One-time admin token bootstrap |
| `patchwire-agent log [--user] [--project] [--since] [--limit]` | Tail audit log |

All admin mutations stay local (SSH to box). Nothing over HTTP.

### 5.2 New laptop CLI behavior

- `patchwire setup` learns to accept a per-user token and writes
  `PW_USER=<name>` to `~/.patchwire/env`.
- `patchwire whoami` calls agent `/me`, returns `{ user, projects,
  queue_position_if_any }`.
- `patchwire ask` shows `queued (position 2 of 3)` when capped, transitions
  to live output when the semaphore is acquired.
- `patchwire status` calls `/queue` for a read-only snapshot.

### 5.3 HTTP endpoint surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | Liveness (unchanged) |
| `GET` | `/me` | user token | Identity + current state |
| `POST` | `/ask` | user token | SSE stream (see §6) |
| `GET` | `/queue` | user token | Read-only queue snapshot |
| `GET` | `/admin/users` | admin token | Per-user usage summary |
| `GET` | `/admin/log` | admin token | Paginated audit log |
| `GET` | `/admin/queue` | admin token | Live queue snapshot |
| `GET` | `/admin/stats` | admin token | Aggregated usage |
| `GET` | `/admin/` | admin token | HTML pages (overview, users, logs) |

No `/exec`. No admin-over-HTTP mutations. Same port (8787) as today; admin
panel inherits the agent's network posture (Tailscale-only or LAN, your choice).

## 6. Data flow + wire protocol

### 6.1 Request lifecycle for `patchwire ask`

```
Alice's laptop                         agent
  |                                     |
  | rsync -az --delete \                |
  |   ./ alice@agent:PROJECTS/alice/flutter-app/
  |------------------------------------>|
  |                                     |
  | POST /ask  (SSE response)           |
  | Authorization: Bearer <alice-token> |
  | Body: { prompt, project: "flutter-app" }
  |------------------------------------>|
  |                                     | 1. Resolve token → "alice"
  |                                     |    (401 if token unknown, 403 if user disabled)
  |                                     | 2. Resolve dir → PROJECTS/alice/flutter-app
  |                                     |    (404 missing, 412 not git, 409 dirty)
  |                                     | 3. Acquire global + per-user semaphores
  |<-- event: queued {pos:2,total:3}    |    (only if wait > 0ms)
  |<-- event: started                   |
  |                                     | 4. Spawn `claude --print`, hold semaphores
  |<-- event: done {diff, files, ...}   |
  |                                     | 5. git reset --hard / clean -fd
  |                                     |    release semaphores, append log line
  | colorize, confirm, git apply        |
```

### 6.2 SSE event format

```
event: queued
data: {"position":2,"total":3}

event: started
data: {"started_at":"2026-06-01T12:00:00Z"}

event: done
data: {
  "diff":"…","files":[…],
  "duration_ms":42100,"queue_wait_ms":3400,
  "stdout":"…","stderr":"…","exit_code":0
}
```

`queued` is emitted only when the request actually waits. The CLI is the
only blessed consumer; no JSON fallback for v1. The VS Code extension uses
the same stream.

### 6.3 Status-code map

| Code | Meaning | Change from v0.1 |
|---|---|---|
| 401 | Missing/invalid token | unchanged |
| 403 | Token valid, user disabled | new |
| 404 | Project dir missing | scoped to `<user>/<project>` |
| 409 | Working tree dirty | per-user (doesn't block others) |
| 412 | Not a git repo | unchanged |
| 503 | Agent restarting / shutting down | new |
| 507 | Insufficient disk space | new (pre-flight `df` check) |

## 7. Error handling

| Scenario | Detection | Behavior |
|---|---|---|
| Token revoked mid-stream | Re-check on each event emit | Close SSE with `event: error data: {"code":"token_revoked"}`; agent kills the running Claude process |
| Agent restart while queued | n/a (queue is in-memory) | Connection drops; CLI surfaces `503 agent_restart`; user retries |
| Agent restart mid-run | SIGTERM to Claude process | `finally` block resets working tree; SSE closes with `agent_restart` |
| Per-user dir absent (first request) | `path.exists` check | Auto-create `PROJECTS/<user>/`; project itself still 404s until rsync |
| Disk pressure (per-user clones × N) | Pre-flight `df` | 507 with free-bytes payload; admin panel surfaces it |
| SSE client doesn't drain (TCP backpressure) | 60s write timeout | Server aborts, kills Claude, releases semaphore |
| Two devs `ask` same project + same prompt | n/a — different clones | Both run independently. By design. |

## 8. Admin panel

### 8.1 Principles

- **Read-only over HTTP.** All mutations remain on the agent box, via local CLI.
- **Same port, same network posture.** No new exposure surface.
- **Zero build dependency.** Server-rendered HTML + minimal vanilla JS.

### 8.2 Auth

Separate admin token, generated by `patchwire-agent admin init` (one-time).
The plaintext token is printed once at init and written to
`~/.patchwire/admin.env` so the admin can retrieve it later; the agent
itself only ever stores and compares the SHA-256 hash, kept in `users.json`
under the reserved `__admin__` entry. Sent as `Authorization: Bearer
<admin-token>` to `/admin/*`. Constant-time compare. User tokens get 403 on
`/admin/*` even if otherwise valid.

### 8.3 Pages

- `/admin/` — overview: total users, active queue, last-24h activity, sparklines
- `/admin/users/` — table: name, last_seen, requests (7d), Claude-seconds (7d), disk usage
- `/admin/logs/` — paginated audit log viewer with filter chips (user, project, since)

JS does a 5s poll on the queue widget; everything else is server-rendered on
each request. Total UI weight: ~600 lines of TS templates + CSS, no
framework.

### 8.4 Stats endpoint shape

```json
GET /admin/stats?window=7d
{
  "window": "7d",
  "requests": { "total": 412, "success": 401, "failed": 11 },
  "duration_ms": { "p50": 18200, "p95": 73000 },
  "queue_wait_ms": { "p50": 0, "p95": 4200 },
  "top_users":    [{"user":"alice","requests":180}, ...],
  "top_projects": [{"project":"flutter-app","requests":260}, ...],
  "daily": [{"day":"2026-05-26","requests":52}, ...]
}
```

## 9. Testing strategy

The current repo has 15 vitest tests. Multi-user adds:

1. **Identity unit tests** — token → user resolution, hash compare, disabled-user
   rejection, username regex enforcement.
2. **Path-resolution security tests** — verify no input (`..`, symlinks, weird
   unicode) escapes `PROJECTS/<user>/`.
3. **Concurrency tests** — 10 concurrent `/ask` with mocked Claude; assert
   global cap, per-user cap, FIFO ordering, queue events emitted only when
   actually queued.
4. **SSE protocol tests** — happy path (started → done), queued path, error
   paths (token_revoked, agent_restart).
5. **Audit log tests** — every request produces exactly one log line; rotation
   kicks in at threshold; admin filter queries work.
6. **Admin panel integration tests** — admin gate on every `/admin/*`; user
   token gets 403; HTML pages render with seeded data.
7. **Migration tests** — v0.1 single-token config auto-migrates to `default`
   user; existing `PROJECTS/<project>/` trees move under `PROJECTS/default/`.
8. **End-to-end happy path** — two users, real test git repo, real rsync to
   tmpfs, mocked Claude returning a fixed diff.

## 10. Migration from v0.1

**Auto-migrate on first v0.2 agent start.** Detect legacy state and:

1. If `users.json` is absent **and** a legacy token exists → create user
   `default` with that token's hash. The old laptop's existing token
   continues to authenticate, now resolving to user `default`.
2. If `PROJECTS/<project>/` directories exist outside any `<user>/` namespace
   → move them into `PROJECTS/default/<project>/`. One-shot; logged.
3. Print on agent start:
   `migrated v0.1 → v0.2: 1 user (default), N projects`.

Laptops on v0.1 keep working unchanged. When they upgrade, `patchwire setup`
writes `PW_USER=default` (or a chosen name) to their env. Single-developer
installs never have to know multi-user exists.

`patchwire-agent install` gains an optional `--multi-user` flag that skips
default-user creation and requires explicit `user add` next.

## 11. Rollout phases

Six shippable phases. Each is independently mergeable and useful.

| Phase | Scope | Ships as |
|---|---|---|
| 1 | Identity layer: `users.json`, token CRUD CLI, per-user auth, `/me`. Legacy token auto-migrates to `default`. | v0.2.0 |
| 2 | Per-user project paths: `PROJECTS/<user>/<project>`, laptop `PW_USER`, one-shot tree migration. | v0.2.1 |
| 3 | Concurrency + queue: global+per-user semaphores. Pre-SSE, queue position is conveyed via the `X-Patchwire-Queue-Position` response header on a still-synchronous `/ask`. | v0.2.2 |
| 4 | Audit log: JSONL writer, rotation, `patchwire-agent log` CLI. | v0.2.3 |
| 5 | SSE protocol on `/ask`: convert sync JSON → stream with `queued`/`started`/`done`. CLI consumes events. | v0.3.0 |
| 6 | Admin panel: `/admin/*` read-only endpoints, admin token bootstrap, HTML pages, usage charts. | v0.3.1 |

Phases 1–4 land observability and isolation without the wire-format break.
Phase 5 cuts over to SSE. Phase 6 layers the panel.

## 12. Open questions / deferred to follow-up specs

- **Streaming Claude stdout live** in the SSE channel (separate event type) —
  roadmap item v0.2.x, complementary but not gating.
- **VS Code extension** — already present in `packages/extension/`. Should
  consume the new SSE protocol once phase 5 lands; surface admin panel inside
  the IDE side panel as a stretch goal.
- **Shared read-only mirror** at `PROJECTS/shared/` so users can browse each
  other's project state without coupling. Not in this spec.
- **Per-user disk quotas** once we have a few weeks of observed usage from
  the admin panel.
- **Notification hooks** (webhook on done, Slack/email integration) once
  streaming UX is stable.
