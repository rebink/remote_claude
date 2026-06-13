# Patchwire — Requirements & Setup

What you actually need for Patchwire to work end-to-end, grounded in the code. Run `patchwire doctor` to check most of this automatically.

Patchwire's shape: you work locally (VS Code extension or CLI); a remote machine you control runs Claude Code with full repo context; results come back as a reviewable diff and/or stay in two-way sync.

```
  Laptop (client)                                Remote "agent" (a Mac today)
  ┌───────────────┐   SSH (bootstrap + sync)    ┌──────────────────────────┐
  │ extension/CLI │ ──────────────────────────▶ │ patchwire agent :7878     │
  │ + patchwire.yml│   HTTP/NDJSON (bearer token)│ spawns `claude --print`   │
  └───────────────┘ ◀────────────────────────── │ git diff of a clean tree  │
        over the Tailscale tailnet               └──────────────────────────┘
```

---

## 1. Remote agent machine (the server)

> Today this must be a **Mac**. Linux/Windows agents are on the v2 roadmap (the capability-detection groundwork exists; the per-OS service/secrets/egress impls do not).

| Requirement | Why |
|---|---|
| **macOS** | The service (launchd), secrets (keychain), and egress sandbox (`sandbox-exec`/seatbelt) layers are macOS-only. |
| **Node ≥ 20** | Agent runtime (`engines.node`). |
| **Claude Code CLI (`claude`), logged in** | The agent spawns `claude --print`. Auth lives in the macOS **keychain**; it must be unlocked (the agent disables its idle auto-lock). Override the binary with `PW_AI_BIN`. |
| **git** | The agent runs Claude against a clean checkout and derives a unified diff. |
| **The patchwire agent process running on port 7878** | `PW_AGENT_PORT` (default 7878). Usually installed as a **launchd** service. |
| **A sync engine** | **Mutagen** (live two-way sync; the extension auto-resolves/installs it) or **rsync** (one-shot CLI push, Unix-only). |
| *(recommended)* **`sandbox-exec` present** | Enables `PW_EGRESS=deny` — a default-deny network sandbox around the AI process. macOS only; fail-closed when unavailable. |

## 2. Local client (your laptop)

| Requirement | Notes |
|---|---|
| **Node ≥ 20** | |
| **git** | Patches `git apply` locally; the working dir must be a git repo. |
| **ssh** | Built in on macOS/Linux and Windows 10+. Used for sync + bootstrap. |
| **A sync engine** | macOS/Linux: `rsync` works. **Windows: use the VS Code extension** (syncs via Mutagen — the CLI's rsync path is Unix-only and refuses on Windows with a pointer here). |
| **The VS Code extension** *or* **the CLI** (`@rebink/patchwire`) | The extension bundles the CLI. |
| **`patchwire.yml`** in your repo | Created by `patchwire init`. Describes the remote (host, user, sshPort, path, `agentUrl`, token) + `sync.exclude`. |

## 3. Networking

- **Tailscale** on both machines. The config uses a tailnet address (e.g. `100.100.100.100`) and `http://<host>:7878`. This keeps the agent **off the public internet** — treat it as required, not optional.

## 4. Authentication & secrets

- **Per-project SSH key** under `~/.patchwire/keys/<host>-<user>` — key-only auth, `StrictHostKeyChecking=accept-new`.
- **Agent bearer token** (`PW_TOKEN`) shared between `patchwire.yml` and the agent. Every HTTP/NDJSON call is authenticated with it. The token is stored on the agent in a mode-600 env file.
- **An Anthropic account/subscription** that `claude` is logged into on the remote.

## 5. Building & shipping (maintainers)

- `pnpm install && pnpm -r build` (repo is a pnpm workspace). Keep `pnpm typecheck && pnpm test && pnpm build` green — CI runs Node 20 & 22.
- **Extension** → package + publish the VSIX to the VS Code Marketplace (`vsce`); the CLI is bundled inside (self-contained — verified by `check-bundle.mjs`).
- **CLI** → publish `@rebink/patchwire` to npm.
- **Website** (`packages/website`, Next.js) → deploys to **Vercel**.
- *(optional)* Bundle a Mutagen binary into the VSIX/npm for fully-offline installs. Not required today: the resolver auto-downloads + checksum-verifies Mutagen (pinned v0.18.1) on first use.

## 6. Quick start (working setup, today)

1. On a Mac you control: install Node ≥ 20, `git`, Claude Code, and `claude /login`. Join your Tailscale tailnet.
2. Start the agent on `:7878` with a `PW_TOKEN` (launchd install via the setup flow).
3. On your laptop: install the extension (or CLI), join the same tailnet.
4. In your repo: `patchwire init`, fill in the remote host/user/path/token, then `patchwire doctor` to verify.
5. Push/sync and review the diff.

## 7. Known gaps (v2 roadmap, not yet shippable)

- **Server must be a Mac.** Linux/Windows agents need the per-OS service/secrets/egress implementations (S2/S3).
- **Zero-touch SSH provisioning** is designed (detection + provisioning engine landed); the **remote install executors are not built**, so the agent is still set up by hand.
- **Cost/usage billing, multi-user/org/RBAC, and the workspace projection engine** are specified, not implemented.
