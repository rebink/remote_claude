# Remote Claude — VS Code Extension

Chat with Claude on a remote Mac Mini from inside VS Code. Your workspace stays local; Claude runs on the remote and returns reviewable unified diffs.

Driving use case: Flutter developers who keep a USB device plugged into their laptop and can't run their app on the remote, but still want Claude's context-aware help.

Design spec: [`../docs/superpowers/specs/2026-05-20-vscode-extension-v2-design.md`](../docs/superpowers/specs/2026-05-20-vscode-extension-v2-design.md)

---

## Prerequisites

1. **`remote-claude` CLI on this laptop** — install per the [root README](../README.md). The extension shells out to it for every operation.
2. **Mac Mini reachable over Tailscale** with `remote-claude` running as the agent. The setup wizard provisions this for you on first run.
3. **VS Code 1.80+** and **Node 20+**.

The extension does not bundle the CLI. Run `remote-claude --version` in a terminal to confirm it is on your `$PATH` before launching VS Code.

---

## Install the extension

You have two paths. Pick (A) if you are using the extension, (B) if you are developing it.

### A. Install a packaged `.vsix` (end users)

```bash
# from repo root
pnpm install
pnpm --filter remote-claude-vscode build
pnpm --filter remote-claude-vscode package
```

This produces `remote-claude-vscode-0.1.0.vsix`. Install it in VS Code:

- **GUI:** Extensions sidebar → `…` menu (top right) → **Install from VSIX…** → pick the file.
- **CLI:** `code --install-extension remote-claude-vscode-0.1.0.vsix`

Reload VS Code when prompted. A **Remote Claude** icon (speech bubble) appears in the activity bar.

### B. Run from source (developers)

```bash
pnpm install
pnpm --filter remote-claude-vscode build
```

Open the `extension/` folder in VS Code and press **F5**. A new "Extension Development Host" window launches with the extension loaded. Edit code in the original window; reload the dev host with `Ctrl/Cmd+R` to pick up changes. For watch-mode builds use `pnpm --filter remote-claude-vscode dev`.

---

## First-time setup (≤ 3 minutes)

1. Open any folder in VS Code — empty repo or existing.
2. Open the command palette (`Ctrl/Cmd+Shift+P`) and run **Remote Claude: Setup…**.
3. The wizard walks four steps:
   - **Pick a peer.** Lists your Tailscale peers; choose the Mac Mini, or type an `IP/hostname` if Tailscale isn't running.
   - **Authenticate once.** Enter your SSH username and system password. A per-project SSH key is installed via vendored `sshpass` + `ssh-copy-id`; the password is held in memory and zeroed afterward.
   - **Bootstrap the project.** Provide a Git URL. The extension `git clone`s locally; the agent `git clone`s into `~/workspace/<project>` on the remote and writes `remote-claude.yml`.
   - **Doctor.** Health checks the agent, then offers to reload the window so the extension picks up the new config.

You are done. The status bar should now show **Remote Claude: in sync**.

---

## Daily use

### Start a chat

- Click the **Remote Claude** activity-bar icon, or run **Remote Claude: New Chat** from the palette.
- Type a prompt. Claude streams its reply into the chat panel.
- File changes appear as **diff cards** at the end of the turn.

### Review and apply diffs

Each diff card has three actions:

- **Open diff** — VS Code's native diff editor opens with the proposed change on the right.
- **Apply** — runs `git apply --3way` for that file (or the whole turn).
- **Reject** — discards the proposed change for that file.

You stay in control: nothing is written to your working tree until you click **Apply**. Per-file selective apply is supported.

### Multi-turn chat

- The remote process is `claude --resume <session-id>` per chat, so each chat keeps full conversational context across turns.
- **`+ New chat`** to start fresh; **chat list** to switch; **Delete chat** to remove it locally and tear down the remote session.

### Sync state

- **Sync-on-ask** is the default: before sending a turn, the extension rsyncs your tree to the remote.
- **Live sync toggle** (status bar) — turn it ON during focused pairing. A file watcher + debounced rsync keeps the remote up-to-date as you type. Turn it OFF when you're hacking locally and don't want every save shipped.
- **Out-of-sync indicators** — file decorations in the Explorer mark dirty paths; the status bar shows `in sync / syncing… / out of sync`.
- **Ask-time guard** — if live sync is OFF and your tree is dirty when you hit Send, a modal warns before proceeding.

---

## Commands

| Palette title | Command id |
|---|---|
| Remote Claude: Setup… | `remoteClaude.openSetup` |
| Remote Claude: New Chat | `remoteClaude.newChat` |
| Remote Claude: Toggle Live Sync | `remoteClaude.toggleLiveSync` |
| Remote Claude: Show Output | `remoteClaude.viewOutput` |

---

## Troubleshooting

| Symptom | Try |
|---|---|
| Extension never activates | Check the **Remote Claude** output channel (`Remote Claude: Show Output`). Most failures log the underlying CLI error there. |
| `remote-claude: command not found` | The extension can't find the CLI. Reinstall it on your `$PATH`, then reload VS Code. |
| Setup wizard hangs on Step 2 | Tailscale or SSH connectivity issue. Confirm `ssh <user>@<peer>` works in a terminal. |
| Chat replies arrive in fragments / interleaved | A previous version had a streaming throttle bug; pull latest and rebuild (`pnpm -r build`). |
| Reload mid-turn shows "session was in flight" | Expected — v1 surfaces a system message and resets. Stream reattach is a v1.1 item. |
| Apply fails with conflict | The remote tree drifted from the local tree. Re-sync (status bar) and try again, or open the diff and resolve manually. |

For agent-side problems, also run `remote-claude doctor` in a terminal.

---

## Known v1 limitations

- Reload reconciliation does **not** reattach to an in-flight stream — it surfaces a system message and resets.
- Tool-use frames from Claude are summarized as plain text, not rendered specially.
- One in-flight turn per chat. Concurrent turns are deferred.
- Single-root workspaces only; one `remote-claude.yml` per project.
- Multi-dev isolation relies on per-user SSH accounts on the remote.
