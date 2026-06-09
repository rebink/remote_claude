# Patchwire for VS Code

Run a Claude Code session on a machine you own, right from your editor. Patchwire opens the session on your own remote box over SSH and keeps your laptop and that machine in two-way sync, so the edits Claude makes land on your laptop as it makes them and you build, run, and debug on your own machine.

Your code stays on hardware you control. It is never handed to a vendor's agent cloud.

## What it does

- **Focus Claude session.** One click opens the real Claude Code REPL running on your remote, inside a VS Code terminal.
- **Two-way sync.** Your laptop and the remote stay byte-identical (powered by Mutagen). Flush or pause the sync from the panel.
- **Setup wizard.** Connect a remote over Tailscale or plain SSH and install a per-project key in a few clicks.
- **Attachments.** Send a local file or a clipboard screenshot to the session, images included for vision. Staged files show in the panel, where you can open or delete any of them.

## Requirements

- VS Code 1.80 or newer.
- A Mac or Linux machine you can reach over SSH (a Tailscale tailnet is the easy path), with Claude Code installed on it. The setup wizard provisions the connection on first run.

The `patchwire` CLI is bundled in the extension and runs on VS Code's own Node, so you do not need to install anything else on your laptop.

## Install

- **VS Code Marketplace:** search "Patchwire" in the Extensions panel, or open `vscode:extension/patchwire.patchwire-vscode`.
- **Open VSX** (Cursor, VSCodium, Windsurf): search "Patchwire" in the Extensions panel.
- **From a `.vsix`:** download it from the [GitHub releases](https://github.com/rebink/remote_claude/releases) and run *Install from VSIX…*.

## First-time setup

1. Open a project folder in VS Code.
2. Run **Patchwire: Setup…** from the command palette.
3. The wizard connects a remote (pick a Tailscale peer or type a host), installs a per-project SSH key, clones the project locally and on the remote, and writes `patchwire.yml`.

When it finishes, the Patchwire panel shows your project and the live sync status.

## Using it

Open the **Patchwire** view from the activity bar:

- **Focus Claude session** opens the Claude Code terminal on your remote. Type as you would in any `claude` session; edits it makes sync back to your laptop.
- The **Two-way sync** card shows the live status (`In sync`, `Syncing`, `Paused`) with **Flush now** and **Pause** controls. If both ends change the same file in the same window, your laptop's version wins and the remote's copy is preserved alongside it.
- The **Attachments** list shows files staged for the session. Open one (images preview in VS Code) or delete it; deleting clears the remote copy too.
- **Show output** opens the Patchwire log.

## Commands

| Palette title | Command id |
|---|---|
| Patchwire: Setup… | `patchwire.openSetup` |
| Patchwire: Show Output | `patchwire.viewOutput` |
| Attach file to claude session | `patchwire.attachFile` |
| Attach clipboard image to claude session | `patchwire.attachClipboardImage` |

## Privacy

Patchwire runs on machines you control. Your code lives on your own remote, not a third-party agent service. What Claude itself sees is the same as running `claude` directly. See the [security model](https://patchwire.vercel.app/security/).

## Docs

Full documentation: [patchwire.vercel.app](https://patchwire.vercel.app/), including the [quickstart](https://patchwire.vercel.app/quickstart/), [configuration](https://patchwire.vercel.app/configuration/), and [security model](https://patchwire.vercel.app/security/).

## Develop

```bash
pnpm install
pnpm --filter patchwire-vscode build
```

Open the repo in VS Code and press **F5** for an Extension Development Host. For watch-mode builds: `pnpm --filter patchwire-vscode dev`.
