# Service Projection — Phase 3 (VS Code Extension) Design Spec

**Date:** 2026-06-19
**Status:** Approved for implementation
**Topic:** A VS Code extension "Services" tree view that drives the same `services serve --stream` session — discover local services, bind them onto the remote agent's loopback, show live status — as a thin native client.

**Depends on:** Phase 1 (PR #74, engine + CLI) and Phase 2 (PR #75, the `services serve --stream` streaming session). P3's implementation branch should be based on the P2 branch until P1/P2 merge.

**Specs:** `docs/superpowers/specs/2026-06-19-service-projection-design.md` (P1), `…-p2-desktop-design.md` (P2).

## Problem

P1 shipped the engine + CLI; P2 shipped the desktop panel + the long-lived `patchwire services serve --stream` session protocol. Developers who live in VS Code (the extension already provides Setup, Chat, and Live Sync) have no way to discover or bind their local services. P3 adds a **Services tree view** in the existing Patchwire activity-bar container, driving the identical session protocol.

Because the extension host runs in Node on the laptop, it spawns the CLI session directly via `child_process` — there is no Tauri/Rust boundary as in the desktop. This makes P3 a genuinely thin client: a controller (modeled on the existing `MutagenController`) plus a native `TreeDataProvider`.

## Goals

- A native `TreeView` listing discovered local services with live status, in the existing `patchwire` activity-bar container.
- Bind/unbind (toggle), retry, and copy-address actions via tree item menus.
- Lazy lifecycle: start the session when the view first becomes visible; auto-rebind persisted services then.
- Persist bound service ids in `workspaceState`.
- Reuse the P2 `serve --stream` protocol unchanged.

## Non-Goals

- No webview UI (native TreeView only — the "thin client" choice).
- No new CLI or engine changes; the session protocol is reused as-is.
- No eager/startup session spawn — strictly lazy on view reveal.
- No Dart VM auto-detection in the extension (Docker-only discovery + `PW_DART_OUTPUT` env; Dart detection deferred — see Limitations).

## Approved Decisions

| Decision | Choice |
|----------|--------|
| UI surface | Native `TreeDataProvider` (Approach A) |
| Session start | Lazy — when the Services view first becomes visible |
| Auto-rebind | Yes — rebind persisted ids on session start |
| Persistence | `context.workspaceState`, key `patchwire.boundServiceIds` |
| Protocol parser | Extension-local copy (DRY-to-core noted as later cleanup) |

## Architecture

```
 VS CODE EXTENSION HOST (Node, on the laptop)            CLI (spawned child)
 ┌───────────────────────────────────────┐              ┌──────────────────────────────┐
 │ ServicesTreeProvider (TreeDataProvider)│              │ patchwire services serve      │
 │   getChildren → ServiceItem[]          │  stdin       │   --stream                    │
 │        ▲ onDidChangeTreeData            │  {cmd:…}     │   (owns the hardened manager) │
 │ ServicesController                      │ ───────────▶ │                               │
 │   spawn(serve --stream), line-buffer    │  stdout      │   emits {candidates|status|   │
 │   stdout → protocol → onDidChange       │ ◀─────────── │    error}, writes manifest    │
 │   send(cmd) → child.stdin               │  NDJSON      │        │ ssh -R (loopback)     │
 │ commands: bind/unbind/retry/copy        │              └────────┼──────────────────────┘
 │ workspaceState: boundServiceIds         │                       ▼ remote 127.0.0.1:port
 └───────────────────────────────────────┘
```

## Components

### 1. Protocol — `packages/extension/src/services/protocol.ts`

Pure, extension-local (mirrors `packages/desktop/src/lib/services-session.ts`):
- Types `WireService`, `WireProjection`, `ServicesEvent` (`candidates`|`status`|`error`), `ServicesView` `{ candidates, projections, error? }`, `initialServices`.
- `parseServicesLine(raw): ServicesEvent | null` — JSON-parse guarded, validates `type` + payload field.
- `reduceServices(state, ev): ServicesView`.

### 2. ServicesController — `packages/extension/src/services/ServicesController.ts`

Models `MutagenController` (an `EventEmitter`-based controller). Constructor takes the resolved CLI invocation (command/args/env/cwd from `resolveCli`) and an injectable spawn function (default `child_process.spawn`) for testability.

- `start()` — idempotent; spawn `[...baseArgs, 'services', 'serve', '--stream']` in the workspace cwd; line-buffer `stdout` (`data` → split on `\n`), `parseServicesLine` each, `reduceServices` into the held `ServicesView`, fire `onDidChange(view)`. On child exit, emit a `stopped` state and clear the child.
- `send(cmd: Record<string, unknown>)` — write `JSON.stringify(cmd) + '\n'` to the child's stdin; no-op (logged) if not running.
- `discover()` / `bind(id)` / `unbind(id)` / `retry(id)` — thin wrappers over `send`.
- `stop()` — kill the child; reset state.
- `readonly onDidChange: vscode.Event<ServicesView>`.

### 3. ServicesTreeProvider — `packages/extension/src/services/ServicesTreeProvider.ts`

`vscode.TreeDataProvider<ServiceItem>`:
- `getChildren()` returns one `ServiceItem` per `view.candidates` (or a single placeholder item when empty / no `patchwire.yml` / session stopped).
- `getTreeItem(item)` → `TreeItem` with: `label` = service label; `description` = `<status> · 127.0.0.1:<remotePort>` (addr omitted when not bound); `iconPath` = `ThemeIcon` by status (`available`→`circle-outline`, `binding`/`reconnecting`→`sync~spin`, `active`→`pass-filled`, `failed`→`error`, `stale`→`warning`); `contextValue` = `service:<bound|available>:<status>` to gate menus.
- Subscribes to `controller.onDidChange` → fires `onDidChangeTreeData`.
- Holds a reference to the controller's latest `ServicesView`.

`ServiceItem` carries the underlying `WireService` (id, label, connectionHint) + derived `bound`/`status`/`remoteAddr` so commands can act on it.

### 4. Commands + menus — `packages/extension/src/services/commands.ts` + `package.json`

Commands (registered in `extension.ts`): `patchwire.services.bind`, `patchwire.services.unbind`, `patchwire.services.retry`, `patchwire.services.copyAddress`. Each receives the `ServiceItem`. `bind`/`unbind` call `controller.{bind,unbind}(id)` and update `workspaceState`. `retry` → `controller.retry(id)`. `copyAddress` → `vscode.env.clipboard.writeText(remoteAddr)`.

`package.json contributes`:
- `views.patchwire` += `{ id: 'patchwire.services', name: 'Services' }` (tree — no `type`).
- `commands` += the 4 above (with icons for inline).
- `menus`:
  - `view/item/context` entries gated by `when: viewItem =~ /service:available/` (bind), `/service:bound/` (unbind, copyAddress), `/:(failed|stale)$/` (retry).
  - `view/title` optional `Refresh` command (`controller.discover()`).
  - inline group (`"group": "inline"`) for the toggle + copy icons.

### 5. Lifecycle wiring — `packages/extension/src/extension.ts`

- Construct `ServicesController` (lazily — or construct eagerly but only `start()` on view visibility).
- `registerTreeDataProvider('patchwire.services', provider)` and create the `TreeView` to observe `onDidChangeVisibility`: on first `visible === true` with a present `patchwire.yml`, `controller.start()` → `discover()` → for each persisted id `bind(id)`.
- Register the 4 commands.
- `deactivate()` / disposables → `controller.stop()`.
- No `patchwire.yml` → provider renders a single "Run Patchwire: Setup first" item; no spawn.

### 6. Persistence

`context.workspaceState.get/update('patchwire.boundServiceIds', string[])`. The bind command adds an id; unbind removes it; session start reads the list to auto-rebind.

## Data Flow

1. Dev opens the Services view → first `visible` → controller `start()` spawns `serve --stream`.
2. Controller sends `discover` → CLI emits `candidates` → `onDidChange` → tree renders rows (`available`).
3. Controller auto-sends `bind` for each persisted id → `status` events → icons go `sync~spin`→`pass-filled`.
4. Dev clicks bind/unbind on a row → command → `controller.{bind,unbind}` + `workspaceState` update.
5. Container stops → next `discover` (manual Refresh) → `stale`; Retry action re-arms.
6. ssh drop → `reconnecting`→`active` (CLI backoff); exhausted → `failed` + Retry.
7. VS Code window closes / extension deactivates → `controller.stop()` → tunnels drop.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| No `patchwire.yml` | Placeholder item "Run Patchwire: Setup first"; no spawn |
| CLI resolve/spawn fails | Error item + Output-channel log; no crash |
| Session child exits unexpectedly | `stopped` state → placeholder "Session stopped — reopen the view"; restart on next view reveal |
| Malformed stdout line | Ignored (`parseServicesLine` → null) |
| Bind of unknown id (race) | CLI emits `error` event → surfaced as the view error/placeholder |

## Testing

- **protocol** — `parseServicesLine`/`reduceServices` (mirror the desktop reducer tests).
- **ServicesController** — injected fake spawn (stdout `EventEmitter` + stdin sink); assert: `start` spawns the right argv/cwd; stdout lines → `onDidChange` with parsed view; `send`/`bind`/`unbind`/`retry` write the right NDJSON to stdin; `stop` kills the child; child-exit emits stopped.
- **ServicesTreeProvider** — given a `ServicesView`, `getChildren`/`getTreeItem` produce items with correct labels, descriptions, icons, and `contextValue`; empty/no-config/stopped → placeholder. Use `src/test/vscode-stub.ts`.
- **commands** — `bind` calls `controller.bind` + persists to a fake `workspaceState`; `copyAddress` writes the clipboard.

Run via `pnpm --filter patchwire-vscode test` (vitest) + `pnpm --filter patchwire-vscode typecheck` + `build`.

## Limitations / Deferred

- **Dart discovery**: the extension does not detect a running Dart VM Service (no `detect_vm_uri` equivalent); discovery is Docker-only plus `PW_DART_OUTPUT` if set. A future pass can detect the VM Service from the integrated terminal / a known port.
- **Protocol DRY**: `parseServicesLine` is duplicated across desktop and extension; extracting to `@patchwire/core` is a later cleanup.
- Inherits P2's deferred minors (no SIGTERM handler in the session; `unbind`/`retry` no-op on missing id; `binding` status rarely surfaced).

## Build Order (single phase, two sub-units)

1. **Headless core:** `protocol.ts` → `ServicesController.ts` (fully unit-testable with a fake spawn).
2. **VS Code surface:** `ServicesTreeProvider.ts` → commands → `package.json` contributes (view + commands + menus) → `extension.ts` wiring → gate.
