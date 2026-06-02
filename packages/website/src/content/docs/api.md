---
title: HTTP API
description: Every endpoint the agent exposes, with examples.
---

The agent is a tiny Fastify server. `/ask` and `/chat` stream their responses as NDJSON; the other endpoints return plain JSON.

Base URL: whatever you configured as `remote.agentUrl`, e.g. `http://<your-remote-host>:7878`.

## Auth

Every endpoint **except `/health`** requires a bearer token:

```
Authorization: Bearer <PW_AGENT_TOKEN>
```

The compare is constant-time. A wrong / missing token returns `401`.

## `GET /health`

No auth required. Used by `patchwire doctor` and any external monitor.

```bash
curl -s http://<your-remote-host>:7878/health
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

If `claude.found` is `false`, the agent is running but can't fulfill `/ask`. Fix `PW_AI_BIN` or install Claude.

## `POST /ask`

Run a prompt against a project. Responds with an NDJSON event stream
(`application/x-ndjson`) whose terminal `result` event carries a unified diff.

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
| `project` | string | yes | Folder name under `PW_PROJECTS_ROOT`. Restricted to `[a-zA-Z0-9_.-]+`. |

### Response: 200 OK (NDJSON stream)

The body is an NDJSON stream (`application/x-ndjson`): one JSON event per line.
Lifecycle: an optional `queued`, then `accepted`, then exactly one terminal
`result` or `error`.

```
{"type":"queued","position":2}
{"type":"accepted","queueWaitMs":3400}
{"type":"result","diff":"diff --git a/lib/login_bloc.dart…","files":["lib/login_bloc.dart","lib/login_state.dart"],"durationMs":14823,"stdout":"Refactored 2 files…","stderr":"","exitCode":0}
```

| Event | Fields |
| --- | --- |
| `queued` | `position`: global-queue position at entry. Emitted once, only when the request waits. |
| `accepted` | `queueWaitMs`: how long the request waited before a slot was granted. |
| `result` | `diff` (unified git diff; empty string if no changes), `files` (changed filenames), `durationMs`, `stdout`/`stderr` (captured from `claude`), `exitCode` (`claude`'s exit code; a non-zero with empty diff is a hint to check `stderr`). |
| `error` | `code` (`run_failed`, `diff_failed`, or `internal`), `message`. Terminal failure that occurred after the stream began. |

### Pre-flight error codes (before the stream)

| Status | Meaning | Body |
| --- | --- | --- |
| `400` | Invalid body (e.g. project name fails regex) | `{ "error": "invalid body", "issues": [...] }` |
| `401` | Missing or wrong bearer token | `{ "error": "unauthorized" }` |
| `404` | `PW_PROJECTS_ROOT/<project>` does not exist | `{ "error": "project not found: …" }` |
| `409` | Working tree was dirty before the run | `{ "error": "agent working tree is dirty before run", "status": "M file.txt\n" }` |
| `412` | Project dir is not a git repo | `{ "error": "project is not a git repository on agent host" }` |

Failures that occur *after* the stream has started (e.g. Claude failing to run)
are not HTTP errors; they arrive as a terminal `error` event on the stream
(`run_failed` / `diff_failed` / `internal`).

### Idempotency & state

- Every `/ask` runs against a **clean** working tree (or 409s).
- The agent always restores the tree before responding (in a `finally` block).
- There is no per-request state on the agent. Two concurrent `/ask`s for the same project would race, so don't do that. Two for different projects are fine.

## Examples

### Drive it from a script

```bash
TOKEN=…
HOST=<your-remote-host>:7878

curl -sS -X POST "http://$HOST/ask" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"add a HELLO.md","project":"my_app"}' \
  | jq -r 'select(.type=="result").diff' > out.patch

git apply --check out.patch && git apply out.patch
```

### Drive it from Node

```ts
import { request } from 'undici';

const res = await request(`http://${host}/ask`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.PW_TOKEN}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ prompt, project: 'my_app' }),
});
// /ask streams NDJSON: parse each line, keep the terminal `result` event.
let buf = '';
let result;
for await (const chunk of res.body) {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (e.type === 'result') result = e;
    else if (e.type === 'error') throw new Error(e.message);
  }
}
console.log(result.diff);
```

This is roughly what `patchwire ask` does internally. The CLI is a thin wrapper around this API.
