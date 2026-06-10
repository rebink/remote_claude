---
title: Troubleshooting
description: Common failure modes and how to fix them.
---

## `patchwire doctor` fails

Run with verbose mode for stack traces:

```bash
PW_VERBOSE=1 patchwire doctor
```

### `FAIL  ssh user@host`

Check from a vanilla shell:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 <your-user>@<your-remote-host> true
```

Common causes:

- **Public key not on remote.** Run `ssh-copy-id <your-user>@<your-remote-host>`.
- **SSH agent doesn't have your key loaded.** `ssh-add -L` to check.
- **Tailscale isn't up on one of the machines.** `tailscale status` on both.
- **Wrong port.** Override with `remote.sshPort` in `patchwire.yml`.

### `FAIL  agent /health`

```bash
curl -v http://<host>:7878/health
```

- **Connection refused** → agent isn't running. On the remote: `launchctl list | grep com.patchwire.agent`. If not loaded, `patchwire-agent install` again.
- **No route to host** → wrong IP/hostname. If using Tailscale, the device may be offline.
- **`claude.found: false` in the response** → set `PW_AI_BIN` to the full path on the remote and re-install the agent.

### `FAIL  patchwire.yml present`

You haven't run `patchwire setup` yet, or you're in the wrong directory. The file lives at the root of each project.

## `ask` returns no diff

```
! No changes were produced.
```

The agent ran Claude successfully but Claude didn't modify any files. This can mean:

- Your prompt didn't ask for changes (e.g. a question rather than an instruction).
- Claude decided no change was warranted. Check `stdout` in the response (CLI prints it when verbose).
- The prompt was too vague for Claude to act on. Be specific: file names, function names, desired behavior.

## `ask` returns a 409

```
✗ Agent /ask returned 409: agent working tree is dirty before run
```

The project on the remote has uncommitted local changes. Most often: a previous run failed to reset cleanly, or you SSH'd into the remote and edited something.

```bash
ssh <your-user>@<your-remote-host>
cd ~/workspace/<project>
git status            # see what's there
git stash             # if you want to keep it
# or
git reset --hard HEAD && git clean -fd
```

Then re-run the `ask`.

## Patch doesn't apply locally

```
! Patch does not apply cleanly to your local tree.
```

You probably edited the same files locally between sync and apply. Two options:

- **Save and rebase.** The patch is in `.patchwire/last.patch`. Stash your local edits, apply the patch, replay your edits.
- **Re-run with fresh sync.** `patchwire ask "<prompt>"` again so the remote is up to date with your latest local state, then apply.

## rsync deletes files I wanted to keep

`rsync --delete` mirrors the local tree to the remote. If a file exists only on the remote (e.g. you SSH'd in and created it), it'll be removed on the next sync. **The remote is not a place to store work.** Treat it as a staging area for AI runs.

If you genuinely need a file to live only on the remote, add it to `sync.exclude` (honored by both the CLI's rsync and the extension's two-way sync).

## Agent crashes on Claude error

The agent has a `finally` block that resets the working tree even when `claude` fails. If you see a `409` *immediately after* a crash, log into the remote and check `git status`, there may be leftover state. Reset manually and resume.

If this happens repeatedly, please open an issue with the contents of `~/.patchwire/logs/agent.err.log`.

## Diff preview is huge / hard to read

```bash
# save the diff and review with your favorite tool
patchwire ask "<prompt>" --save-only
delta .patchwire/last.patch     # if you have `delta` installed
# or
code -d .patchwire/last.patch
```

## Tailscale device list is empty in `setup`

`patchwire setup` calls `tailscale status --json` on the laptop. If the response has zero peers, you'll fall through to the manual host prompt. Check:

- `tailscale status` shows peers (otherwise you're not logged in)
- the remote is online in your Tailscale admin console
- you're logged into the same tailnet on both machines

## Resetting from scratch

If you want to wipe everything and start over:

```bash
# laptop
rm -rf ~/.patchwire
rm <your-project>/patchwire.yml
rm -rf <your-project>/.patchwire
patchwire setup --force

# remote
patchwire-agent uninstall
rm -rf ~/.patchwire
patchwire-agent install
```
