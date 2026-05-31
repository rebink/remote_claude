---
title: HTTP API
description: Every endpoint the agent exposes, with examples.
---

The agent is a tiny Fastify server. Two endpoints. No streaming (yet).

Base URL: whatever you configured as `remote.agentUrl`, e.g. `http://mac-mini.tail-abc123.ts.net:7878`.

## Auth

Every endpoint **except `/health`** requires a bearer token:

```
Authorization: Bearer <RC_AGENT_TOKEN>
```

The compare is constant-time. A wrong / missing token returns `401`.

## `GET /health`

No auth required. Used by `remote-claude doctor` and any external monitor.

```bash
curl -s http://mini:7878/health
```

```json
{
  "ok": true,
  "version": "0.1.0",
  "claude": {
    "found": true,
    "path": "/usr/local/bin/claude"
  }
}
```

If `claude.found` is `false`, the agent is running but won't be able to fulfil `/ask` — fix `RC_CLAUDE_BIN` or install Claude.

## `POST /ask`

Run a prompt against a project. Returns a unified diff.

### Request

```http
POST /ask HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{
  "prompt": "refactor login_bloc to use freezed",
  "project": "my_flutter_app"
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `prompt` | string | yes | Free-form instruction for Claude. Sent on stdin to `claude --print`. |
| `project` | string | yes | Folder name under `RC_PROJECTS_ROOT`. Restricted to `[a-zA-Z0-9_.-]+`. |

### Response — 200 OK

```json
{
  "diff": "diff --git a/lib/login_bloc.dart b/lib/login_bloc.dart\n…",
  "files": ["lib/login_bloc.dart", "lib/login_state.dart"],
  "durationMs": 14823,
  "stdout": "Refactored 2 files…",
  "stderr": "",
  "exitCode": 0
}
```

| Field | Notes |
| --- | --- |
| `diff` | Unified diff (git format). Empty string if Claude made no changes. |
| `files` | List of files changed (`git diff --cached --name-only`). |
| `durationMs` | Time from request received to response sent. |
| `stdout` / `stderr` | Captured from `claude` for debugging. |
| `exitCode` | `claude`'s exit code. Usually 0; a non-zero with empty diff is a hint to look at `stderr`. |

### Response — error codes

| Status | Meaning | Body |
| --- | --- | --- |
| `400` | Invalid body (e.g. project name fails regex) | `{ "error": "invalid body", "issues": [...] }` |
| `401` | Missing or wrong bearer token | `{ "error": "unauthorized" }` |
| `404` | `RC_PROJECTS_ROOT/<project>` does not exist | `{ "error": "project not found: …" }` |
| `409` | Working tree was dirty before the run | `{ "error": "agent working tree is dirty before run", "status": "M file.txt\n" }` |
| `412` | Project dir is not a git repo | `{ "error": "project is not a git repository on agent host" }` |
| `500` | Claude execution error or unexpected failure | `{ "error": "<message>" }` |

### Idempotency & state

- Every `/ask` runs against a **clean** working tree (or 409s).
- The agent always restores the tree before responding (in a `finally` block).
- There is no per-request state on the agent. Two concurrent `/ask`s for the same project would race — don't do that. Two for different projects are fine.

## Examples

### Drive it from a script

```bash
TOKEN=…
HOST=mac-mini.tail-abc123.ts.net:7878

curl -sS -X POST "http://$HOST/ask" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"add a HELLO.md","project":"my_app"}' \
  | jq -r .diff > out.patch

git apply --check out.patch && git apply out.patch
```

### Drive it from Node

```ts
import { request } from 'undici';

const res = await request(`http://${host}/ask`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.RC_TOKEN}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ prompt, project: 'my_app' }),
});
const json = await res.body.json();
console.log(json.diff);
```

This is roughly what `remote-claude ask` does internally — the CLI is a thin wrapper around this API.
