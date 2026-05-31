# patchwire

Local-first dev tool: push your project to a remote Mac Mini (or any remote box), run Claude Code there, and pull back a reviewable unified diff. The remote machine never edits your laptop's filesystem directly — every change crosses the wire as a patch you preview and `git apply` yourself.

**Full docs:** [patchwire.vercel.app](https://patchwire.vercel.app)

## Install

```bash
npm install -g patchwire
```

This installs two binaries:

- `patchwire` — laptop CLI (sync, ask, apply, doctor, setup, init-remote)
- `patchwire-agent` — bearer-token HTTP server that runs on the remote Mac

## Quickstart

On the remote Mac:

```bash
patchwire-agent
```

On your laptop:

```bash
patchwire init-remote   # one-time bootstrap
patchwire ask "refactor the login flow to use the new session helper"
patchwire apply         # review and git-apply the returned diff
```

See [patchwire.vercel.app/quickstart](https://patchwire.vercel.app/quickstart) for the full walkthrough.

## License

MIT
