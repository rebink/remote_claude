---
title: Install the VS Code Extension
description: Get the Patchwire extension running in VS Code or Antigravity in under a minute.
---

The Patchwire extension turns any VS Code-based editor into a bidirectional Claude session against a remote Mac — your laptop edits and the Mini's edits stay byte-identical, automatically.

## Download

import { Badge, LinkButton } from '@astrojs/starlight/components';

<LinkButton href="https://github.com/rebink/patchwire/releases/latest" icon="download">
  Download latest `.vsix`
</LinkButton>

The latest release page has a `patchwire-vscode-X.Y.Z.vsix` file attached. Grab it and install via one of the methods below.

## Install in VS Code

### Option 1 — Command palette (recommended)

1. Open VS Code.
2. `Cmd+Shift+P` (or `Ctrl+Shift+P` on Linux/Windows) → **Extensions: Install from VSIX…**
3. Pick the downloaded `.vsix` file.
4. Reload window when prompted.

### Option 2 — Drag & drop

Drag the `.vsix` file onto the **Extensions** panel in VS Code.

### Option 3 — Command line

```bash
code --install-extension ~/Downloads/patchwire-vscode-0.1.0.vsix
```

If `code` isn't on your PATH, run `Cmd+Shift+P` → **Shell Command: Install 'code' command in PATH** once and try again.

## Install in Antigravity

Antigravity is a VS Code fork, so the same `.vsix` file works. The CLI command is `antigravity` instead of `code`:

```bash
antigravity --install-extension ~/Downloads/patchwire-vscode-0.1.0.vsix
```

Or use the command palette in Antigravity (it has the same **Extensions: Install from VSIX…** action).

## Install in Cursor

Same flow — Cursor also accepts `.vsix` files via the command palette or:

```bash
cursor --install-extension ~/Downloads/patchwire-vscode-0.1.0.vsix
```

## What you need on your machine first

The extension shells out to a few binaries that must be installed:

| Binary | Why | Install |
|---|---|---|
| `patchwire` (the CLI) | Bootstraps the project on the remote Mini | `pnpm add -g github:rebink/patchwire` |
| `mutagen` | Two-way file sync laptop ↔ Mini | `brew install mutagen-io/mutagen/mutagen` |
| `ssh` | Transport | Built into macOS |
| `rsync` | Initial bootstrap | macOS bundles `openrsync`; brew rsync 3.x is more reliable. `brew install rsync` |

On the **remote Mac Mini** you only need:

- An SSH user account with key-based auth (the wizard sets this up via a one-time password prompt).
- `claude` (the Anthropic CLI) — `npm install -g @anthropic-ai/claude-code`.

Mutagen deploys its own agent binary to the Mini automatically the first time it connects.

## After install

1. Click the **Patchwire** speech-bubble icon in the activity bar.
2. The setup wizard opens automatically if no `patchwire.yml` exists in your workspace.
3. Walk through the four steps:
   1. Pick your Mac Mini (IP + username + port)
   2. One-time SSH password to install a per-project key
   3. Push your local folder to bootstrap the remote
   4. Doctor checks everything's healthy
4. The sidebar will show **✓ In sync** once Mutagen connects. Click **⎈ Open Claude session** to drop into a live REPL on the Mini.

## Updating

When a new release ships, download the new `.vsix` and re-run the install. The extension replaces the old version cleanly — your `patchwire.yml`, SSH keys, and Mutagen session all survive.

You can also pin yourself to a specific release by downloading from [github.com/rebink/patchwire/releases](https://github.com/rebink/patchwire/releases).
