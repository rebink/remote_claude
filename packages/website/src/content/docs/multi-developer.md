---
title: Multi-developer
description: How a whole team shares one remote agent without stepping on each other.
---

One remote box can serve a whole team. Every developer gets their own token,
their own isolated checkout, and a fair place in line. The diff still returns to
the laptop that asked for it.

This page ties together the four pieces that make that safe: **identity**,
**isolation**, **fairness**, and a **paper trail**.

## Identity: one token per developer

The agent keeps a user registry at `~/.patchwire/users.json`. It only ever
stores a SHA-256 hash of each token, never the plaintext. The admin manages
users from the remote box:

```bash
# create a developer; the token is printed once
patchwire-agent user add ana
#   → Token (save this, it will not be shown again): pw_b9f...

patchwire-agent user list                 # who exists, active/disabled, last seen
patchwire-agent user disable ana          # token still resolves, every request 403s
patchwire-agent user enable ana
patchwire-agent user rotate ana           # new token; the old one dies immediately
patchwire-agent user rm ana               # remove entirely
```

Each developer loads their token on their laptop once:

```bash
patchwire setup --token pw_b9f...
#   → writes PW_TOKEN + PW_USER to ~/.patchwire/env
```

On every request the agent resolves the bearer token to a username. An unknown
token gets `401`; a known-but-disabled user gets `403`. That username is the key
for everything below.

> Upgrading from v0.1? On first start the agent migrates your single
> `PW_AGENT_TOKEN` into a `default` user automatically, so existing setups keep
> working unchanged.

## Isolation: a checkout per developer

Project files live under a per-user directory on the remote:

```
<projects-root>/<user>/<project>/
```

`patchwire ask` rsyncs your local project into *your* directory (`PW_USER`), and
the agent runs the AI against *that* checkout. Two developers can both have a
project called `team-app` and never touch each other's tree. The agent also
refuses any project path that would escape your user directory.

## Fairness: a queue nobody has to manage

The agent caps how many AI runs happen at once, so one box does not melt under
team load:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PW_MAX_CONCURRENT_TOTAL` | `3` | Global ceiling across everyone. |
| `PW_MAX_CONCURRENT_PER_USER` | `1` | Per-developer ceiling, so nobody hogs all the slots. |

Requests over a cap wait in arrival order (FIFO). Because `/ask` is a streamed
NDJSON endpoint, you watch your place in line in real time:

```
{"type":"queued","position":2}
{"type":"accepted","queueWaitMs":3400}
{"type":"result","diff":"…","files":["…"],"exitCode":0}
```

The CLI surfaces this as `Queued — position 2…` then `Asking Patchwire…`. A
read-only `GET /queue` returns the current snapshot of who is in flight and who
is waiting:

```json
{
  "globalCap": 3,
  "perUserCap": 1,
  "inFlight": ["ana"],
  "queued": [{ "user": "ben", "position": 1 }, { "user": "you", "position": 2 }]
}
```

## Paper trail: the audit log

Every successful `/ask` and `/chat` turn appends one JSONL line to
`~/.patchwire/agent.log` (override with `PW_AUDIT_LOG`):

- `ts`, `user`, `project`, `route`
- `prompt_sha256`: a hash of the prompt. Plaintext is never written to disk.
- For `/ask`: `files`, `lines_added`, `lines_removed`, `exit_code`
- For `/chat`: `uuid`, `tokens_in`, `tokens_out`
- `duration_ms`, `queue_wait_ms`

The file rotates at 50 MiB (`PW_AUDIT_LOG_MAX_BYTES` / `PW_AUDIT_LOG_MAX_FILES`).
Read it with filters:

```bash
patchwire-agent log                          # last 100, pretty
patchwire-agent log --user ana --since 24h
patchwire-agent log --project team-app --limit 10
patchwire-agent log --json                   # raw JSONL, pipe into jq
```

## Where to go next

- [Running the agent](/agent/) covers install, env vars, and the concurrency and
  audit sections in full.
- [HTTP API](/api/) documents the streamed `/ask` events and `GET /queue`.
- [Configuration](/configuration/) lists every environment variable.
- [Security model](/security/) explains token handling and the network posture.
