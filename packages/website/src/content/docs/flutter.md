---
title: Flutter live-attach
description: Give the remote agent scoped control of a Flutter app you run locally, without shipping the app to the remote.
---

## What it does

You run `flutter run` locally against a simulator, a physical device, the web, or a desktop target. Patchwire's desktop **Flutter** panel attaches to the running app's Dart VM Service over a reverse SSH tunnel. The remote `claude` agent then gets a `patchwire-flutter` MCP server exposing four scoped tools:

- `flutter_hot_reload` — apply your latest synced edits to the running app.
- `flutter_screenshot` — capture the current frame.
- `flutter_inspect` — read the live widget tree.
- `flutter_logs` — read runtime logs from the running app.

Compile and run stay on your laptop. The remote only observes and drives the app through those four tools.

## Not the device bridge

This is not the old device bridge, which ran Flutter *remotely* against a device wired to your machine. Here the toolchain never moves: you compile and run locally, exactly as you would without Patchwire. All that crosses the wire is an opt-in observe/control channel into the already-running app — nothing more.

## Capability matrix

| Target | Hot reload | Hot restart | Screenshot | Inspect | Logs |
|---|---|---|---|---|---|
| Simulator / device | ✅ | ✅ | ✅ | ✅ | ✅ |
| Web (DDC) | ⚠️ restart-only | ✅ | ❌ unsupported | ✅ | ✅ |
| Desktop | ✅ | ✅ | ❌ unsupported | ✅ | ✅ |

Flutter web runs on DDC, which has no `_flutter.screenshot` RPC, so screenshots are device/simulator-only (no fallback in this version).

## How to use

1. Open the project in the desktop app and switch to the **Flutter** panel.
2. Paste the VM Service URI printed by `flutter run` (or use **Detect**).
3. Click **Attach**.

The status pill moves through `detached` → `attaching` → `attached`. Re-attach after an app restart — the channel does not survive one.

## Security & privacy (threat model)

This channel is opt-in, per-session, and dev-initiated. It is **off by default**: nothing is exposed until you attach.

- **Loopback-bound.** The reverse tunnel binds the remote host's loopback (`127.0.0.1`) only, so other tailnet peers can't reach it.
- **Scoped tools only.** The MCP server exposes only the four tools above — there is no raw `evaluate` or other arbitrary-eval tool.
- **Ephemeral.** The channel dies when the app restarts. Nothing is persisted except a per-project enabled flag.

This is reverse *ingress* into your laptop — distinct from, and not covered by, the agent's egress controls. That is exactly why it is strictly opt-in.

## Live verification (manual — requires a real device/sim)

1. `flutter run` a debug build locally on a simulator or device; copy the printed VM Service URI.
2. In the desktop app, open the project → Flutter panel → paste the URI → Attach. Pill shows `attached` + target.
3. Ask the remote agent to call `flutter_screenshot`; confirm it returns the current frame.
4. Ask it to make a small UI edit, sync, then `flutter_hot_reload`; confirm the running app updates.
5. Hot-restart the app locally; confirm the pill flips to `detached` (tunnel/WS closed) and re-attach works.
6. Attach a **web** target; confirm `flutter_screenshot` reports "unsupported on web" while inspect/logs work.
