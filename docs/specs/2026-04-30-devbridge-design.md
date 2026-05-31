# DevBridge — Design Spec

**Date:** 2026-04-30
**Status:** Approved (user pre-authorized "recommended way")

## Purpose

Local-first dev tool that pushes a project to a remote Mac Mini, runs Claude Code there with full repo context, and returns a unified diff for safe, reviewable application on the developer's MacBook.

## Non-Goals

- Real-time bidirectional sync
- Direct remote file editing
- Full remote dev environment (LSP, debug, run)

## Architecture

```
MacBook (devbridge CLI)              Mac Mini (devbridge-agent HTTP)
  - source of truth                    - bearer-token auth
  - rsync push (one-way)               - clean working tree per request
  - HTTP /ask                          - spawn `claude --print "$prompt"`
  - git apply patch                    - capture `git diff` + untracked
  - preview UI                         - reset working tree
```

## Components

### CLI binary: `devbridge`

| Command | Behavior |
|---|---|
| `devbridge init` | Write `devbridge.yml`, prompt for host/user/path/token. |
| `devbridge sync` | rsync local → remote (one-way, with excludes). |
| `devbridge ask "<prompt>"` | sync → POST /ask → preview diff → confirm → apply. |
| `devbridge apply [patch]` | Apply a saved `.patch` file with preview. |
| `devbridge doctor` | Check rsync, ssh reachability, agent /health, git in cwd. |

### Agent binary: `devbridge-agent`

Fastify HTTP server.

| Endpoint | Behavior |
|---|---|
| `GET /health` | Returns version + claude CLI presence. |
| `POST /ask` | Body `{ prompt, project }`. Runs claude in `<projects_root>/<project>`, captures git diff, resets, returns `{ diff, files, durationMs, stdout }`. |

Auth: `Authorization: Bearer <token>` (compared with constant-time eq).

### Config — `devbridge.yml` (project root)

```yaml
project: my_flutter_app
remote:
  host: 192.168.1.10
  user: rebin
  path: ~/workspace/my_flutter_app
  agentUrl: http://192.168.1.10:7878
  token: ${DEVBRIDGE_TOKEN}     # env interpolation
sync:
  exclude:
    - build/
    - .dart_tool/
    - ios/Pods/
    - node_modules/
    - .git/
ai:
  command: claude               # path to claude binary on remote
  args: ["--print"]
  timeoutSec: 600
```

## Data Flow — `devbridge ask`

1. CLI loads `devbridge.yml`, validates.
2. CLI runs `rsync -az --delete --exclude-from=<list> ./ user@host:path/`.
3. CLI POSTs `{ prompt, project }` to agent `/ask` with bearer token.
4. Agent:
   a. `cd <projects_root>/<project>`
   b. `git status --porcelain` → if dirty, abort with 409.
   c. Spawn `claude --print "<prompt>"` (stdout/stderr captured).
   d. `git add -A && git diff --cached` → capture diff.
   e. `git reset --hard HEAD && git clean -fd` → restore clean tree.
   f. Respond with diff + metadata.
5. CLI shows colorized preview (per-file).
6. Prompts: `[a]pply all / [s]elective / [r]eject / [w]rite to file`.
7. On apply: `git apply --check` → `git apply` locally.

## Why "let claude edit + git diff" instead of "ask claude for a diff"

Claude Code is reliable at editing files (its native tool). It is unreliable at hand-producing valid unified diffs. We let it edit freely on a clean checkout, then derive the diff from git. This avoids prompt fragility entirely.

## Error Handling

| Failure | Behavior |
|---|---|
| Remote unreachable | Doctor-style hint with the exact ssh command to test. |
| Remote tree dirty | 409 from agent; CLI tells user agent state was unexpected. |
| Claude returns non-zero | Surface stderr; do not produce empty diff. |
| `git apply --check` fails | Show conflict; offer to save patch to `.devbridge/last.patch`. |
| Token missing/invalid | 401 with clear message. |

## Tech Stack

- Node 20+, TypeScript, ESM
- CLI: `commander`, `chalk`, `prompts`, `yaml`, `zod`
- HTTP: `undici` (client), `fastify` (server)
- Build: `tsup` (bundle to dist/), `tsx` (dev)
- Test: `vitest`
- Package manager: pnpm

## Project Layout

```
dev_sync_cli/
├── package.json              # bins: devbridge, devbridge-agent
├── tsconfig.json
├── tsup.config.ts
├── src/
│   ├── cli.ts                # commander entry
│   ├── agent.ts              # fastify entry
│   ├── commands/
│   │   ├── init.ts
│   │   ├── sync.ts
│   │   ├── ask.ts
│   │   ├── apply.ts
│   │   └── doctor.ts
│   ├── lib/
│   │   ├── config.ts         # load + validate devbridge.yml (zod)
│   │   ├── rsync.ts          # spawn rsync
│   │   ├── client.ts         # undici client
│   │   ├── patch.ts          # preview + git apply
│   │   └── log.ts
│   └── agent/
│       ├── server.ts
│       ├── claude.ts         # spawn claude --print
│       ├── git.ts            # status / diff / reset
│       └── auth.ts
├── test/
└── docs/superpowers/
    ├── specs/
    └── plans/
```

## Security

- SSH key auth (no passwords) for rsync.
- Bearer token (env var) for HTTP API.
- Agent binds to a configurable host — recommend LAN-only or `127.0.0.1` + SSH tunnel.
- No file edits ever flow remote → local except via reviewable diff.

## Performance Targets

- Incremental sync (no changes): < 500ms on LAN.
- First sync of small Flutter project (~1k files post-excludes): < 5s.
- Diff preview: render-only, no parsing of large hunks (stream chalk).

## Out of Scope (v1)

- Smart context selection / dependency graphs
- IDE/VS Code extension
- Streaming tokens during agent execution
- Multi-user isolation on the Mac Mini
- Plugin system for non-Claude LLMs

## v1 Acceptance Criteria

1. `devbridge init` produces a valid `devbridge.yml`.
2. `devbridge doctor` reports rsync, ssh, agent /health correctly.
3. `devbridge sync` pushes a sample project to remote, respecting excludes.
4. `devbridge ask "rename foo to bar"` produces a unified diff that `git apply --check` accepts on the local repo.
5. Agent rejects requests without a valid bearer token.
6. Build produces two working binaries via `pnpm build`.
