---
title: Install the VS Code Extension
description: Get the Patchwire extension running in VS Code or Antigravity in under a minute.
---

The Patchwire extension turns any VS Code-based editor into a bidirectional Claude session against your remote machine. Your laptop edits and the remote's edits stay byte-identical, automatically (the extension uses Mutagen for live sync, unlike the CLI's one-way `rsync` model).

import { Badge, LinkButton } from '@astrojs/starlight/components';

## Install in one click

<LinkButton href="vscode:extension/patchwire.patchwire-vscode" icon="external">
  Install in VS Code
</LinkButton>

This opens VS Code on the Patchwire extension page, where you click **Install**. The extension is on the Marketplace and Open VSX, so if the button doesn't open VS Code, use one of the links below.

- **Marketplace page:** <https://marketplace.visualstudio.com/items?itemName=patchwire.patchwire-vscode>
- **Cursor / VSCodium / Windsurf (Open VSX):** <https://open-vsx.org/extension/patchwire/patchwire-vscode>

## Download the `.vsix` (works today)

<LinkButton href="https://github.com/rebink/remote_claude/releases/latest" icon="download">
  Download latest `.vsix`
</LinkButton>

The latest release page has a `patchwire-vscode-X.Y.Z.vsix` file attached. Grab it and install via one of the methods below.

## Install in VS Code

### Option 1: command palette (recommended)

1. Open VS Code.
2. `Cmd+Shift+P` (or `Ctrl+Shift+P` on Linux/Windows), then **Extensions: Install from VSIX…**
3. Pick the downloaded `.vsix` file.
4. Reload the window when prompted.

### Option 2: drag and drop

Drag the `.vsix` file onto the **Extensions** panel in VS Code.

### Option 3: command line

```bash
code --install-extension ~/Downloads/patchwire-vscode-0.3.0.vsix
```

If `code` isn't on your PATH, run `Cmd+Shift+P`, then **Shell Command: Install 'code' command in PATH** once and try again.

## Install in Antigravity

Antigravity is a VS Code fork, so the same `.vsix` file works. The CLI command is `antigravity` instead of `code`:

```bash
antigravity --install-extension ~/Downloads/patchwire-vscode-0.3.0.vsix
```

You can also use the command palette in Antigravity (it has the same **Extensions: Install from VSIX…** action).

## Install in Cursor

Same flow. Cursor also accepts `.vsix` files via the command palette, or:

```bash
cursor --install-extension ~/Downloads/patchwire-vscode-0.3.0.vsix
```

## What you need on your machine first

The extension shells out to a few binaries:

| Binary | Why | Install |
|---|---|---|
| `patchwire` (the CLI) | Bootstraps the project on the remote | `npm i -g @rebink/patchwire` |
| `mutagen` | Two-way file sync between laptop and remote | `brew install mutagen-io/mutagen/mutagen` |
| `ssh` | Transport | Built into macOS |
| `rsync` | Initial bootstrap | macOS ships `openrsync`, but brew rsync 3.x is more reliable: `brew install rsync` |

On the remote machine you need:

- An SSH user account. The wizard sets up key-based auth for you: it runs `ssh-copy-id` in a terminal where you enter your password once. (No `sshpass`, no extra install.)
- `claude` (the Anthropic CLI): `npm install -g @anthropic-ai/claude-code`.

Mutagen deploys its own agent binary to the remote automatically the first time it connects.

## After install

1. Click the **Patchwire** icon in the activity bar.
2. The setup wizard opens automatically if no `patchwire.yml` exists in your workspace.
3. Walk through the four steps:
   1. Pick your remote (IP, username, and port).
   2. Install your key: click **Open terminal & install key**, enter your password once when `ssh-copy-id` prompts, then **Verify & continue**.
   3. Bootstrap the remote: pick a **sync profile** (auto-detected from your project: Flutter, Node, Python, …) and push your local folder.
   4. Doctor checks everything's healthy.
4. The sidebar shows **✓ In sync** once Mutagen connects. Click **⎈ Open Claude session** to drop into a live REPL on the remote.

## Updating

When a new release ships, download the new `.vsix` and re-run the install. The extension replaces the old version cleanly. Your `patchwire.yml`, SSH keys, and Mutagen session all survive.

You can also pin to a specific release by downloading from [github.com/rebink/remote_claude/releases](https://github.com/rebink/remote_claude/releases).
