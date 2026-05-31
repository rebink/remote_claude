# remote-claude

Local-first dev tool: push your project to a remote Mac Mini (or any remote box), run Claude Code there, and pull back a reviewable unified diff. The remote machine never edits your laptop's filesystem directly — every change crosses the wire as a patch you preview and `git apply` yourself.

**Full docs:** [remote-claude.vercel.app](https://remote-claude.vercel.app)

## Install

```bash
npm install -g remote-claude
```

This installs two binaries:

- `remote-claude` — laptop CLI (sync, ask, apply, doctor, setup, init-remote)
- `remote-claude-agent` — bearer-token HTTP server that runs on the remote Mac

## Quickstart

On the remote Mac:

```bash
remote-claude-agent
```

On your laptop:

```bash
remote-claude init-remote   # one-time bootstrap
remote-claude ask "refactor the login flow to use the new session helper"
remote-claude apply         # review and git-apply the returned diff
```

See [remote-claude.vercel.app/quickstart](https://remote-claude.vercel.app/quickstart) for the full walkthrough.

## License

MIT
