# Service Projection — Design Spec

**Date:** 2026-06-19
**Status:** Approved for implementation (Phase 1)
**Topic:** Expose a developer's local services (Docker databases, Flutter/Dart dev servers) to a remotely-running Claude Code agent.

## Problem

Patchwire runs Claude Code on a remote host (over Tailscale/SSH), while the developer's services — the Docker-hosted database, the Flutter app's Dart VM Service, the local Dart dev server — run on the laptop. Today the remote agent cannot reach those services, so it cannot debug or test against the real database, nor drive a live Flutter/Dart server beyond the one-off VM-Service attach already built.

The codebase already contains the exact mechanism in miniature: `packages/cli/src/lib/flutter-tunnel.ts` opens an `ssh -R` reverse tunnel that exposes the locally-running Dart VM Service on the remote agent's loopback. **Service Projection generalizes that one-off into a first-class capability** that can expose any local port to the remote agent, with discovery, same-port mirroring, runtime discovery via MCP, and a debug manifest.

## Goals

- Auto-discover the developer's local Docker services and Flutter/Dart servers, present them, and bind on explicit confirmation.
- Reverse-tunnel each confirmed service onto the remote agent's **loopback only**.
- Mirror the local port number on the remote when free, so existing `localhost:PORT` connection strings work unchanged.
- Let the remotely-running Claude Code discover bound services at runtime (MCP) and as a fallback artifact (manifest file).
- Tie binding lifecycle to the project workspace; auto-heal dropped tunnels.

## Non-Goals

- No forward tunneling (remote→local service exposure to the laptop). Direction is local→remote only.
- No tailnet-wide exposure. Services are reachable only from the agent host's loopback.
- No multiplexed/control-master transport in Phase 1 (the manager interface allows it later — see Transport).
- No GUI in Phase 1. Desktop (P2) and extension (P3) are documented as roadmap, specced separately.

## Approved Decisions

| Decision | Choice |
|----------|--------|
| Declaration | Auto-discover, then confirm before bind |
| Remote discovery | Layered: same-port mirror + MCP services registry + `services.json` manifest fallback |
| Lifecycle | Tied to project workspace (open → bind, leave → unbind), auto-reconnect on reopen |
| Transport | Approach A — supervised per-service `ssh -R`, behind a transport-agnostic manager interface |
| Sequencing | P1 core engine + CLI (internal) → P2 desktop UI (first public release) → P3 extension |

## Architecture

```
 LAPTOP (local)                                   REMOTE AGENT HOST
 ┌─────────────────────────────┐                 ┌──────────────────────────────┐
 │ Discoverers                 │                 │  Claude Code (remote)         │
 │  - DockerDiscoverer         │                 │    │ reads                    │
 │  - DartDiscoverer           │                 │    ├─ MCP: patchwire-services │
 │        │ candidates         │                 │    └─ .patchwire/services.json│
 │        ▼                    │                 │                               │
 │ ServiceProjection manager   │   ssh -R        │  127.0.0.1:remotePort ────────┼─┐
 │  - bind / unbind / status   │ ═══════════════▶│  (loopback only)              │ │
 │  - SshReverseTunnel (A)     │  reverse tunnel │                               │ │
 │  - same-port mirror logic   │                 └──────────────────────────────┘ │
 │        │ projects           │                                                  │
 │        ├─ writes manifest ──┼──────────────────────────────────────────────────┘
 │        └─ updates MCP registry
 └─────────────────────────────┘
```

The manager, discoverers, mirror logic, manifest writer, and MCP registry run **locally** (the laptop is where Docker and the Dart servers live, and where the ssh client initiates the reverse tunnel). The manifest and MCP registry state are projected to the remote so the agent can read them.

## Components

### 1. Service model

```ts
type ServiceKind = 'docker' | 'dart-vm' | 'dart-server' | 'generic';
type ProjectionStatus = 'binding' | 'active' | 'reconnecting' | 'stale' | 'failed';

interface DiscoveredService {
  id: string;            // stable: hash of kind + localPort + identity (container name / vm uri)
  label: string;        // e.g. "Postgres (pw-db)" or "Dart VM :8181"
  kind: ServiceKind;
  localPort: number;
  connectionHint: string; // e.g. "postgres://127.0.0.1:5432" — references localhost only
  meta?: Record<string, string>; // container image, vm-service authPath, etc.
}

interface Projection {
  service: DiscoveredService;
  remotePort: number;    // == localPort when mirrored, else a free remote port
  mirrored: boolean;
  status: ProjectionStatus;
}
```

### 2. Discoverers — `Discoverer` interface

`discover(): Promise<DiscoveredService[]>` — returns candidates only. Never binds.

- **DockerDiscoverer** — runs `docker ps --format '{{json .}}'`, parses container name, published ports, and image. Infers `kind`/label from the image (postgres, mysql, redis, mongo → known; otherwise `generic`). Builds a `connectionHint` from the published port. If Docker is not running, returns `[]` (not an error).
- **DartDiscoverer** — detects a running Flutter/Dart VM Service by reusing `parseVmServiceUri` from `flutter-vmservice.ts`, and detects the Dart dev-server HTTP port. Reuses the existing loopback/SSRF guard (`isLoopbackHost`).

Discovery never auto-binds; the confirm gate is enforced by the caller (CLI prompt in P1, UI confirm in P2/P3).

### 3. ServiceProjection manager — transport-agnostic

```ts
interface Transport {
  open(o: { localPort: number; remotePort: number }): TunnelHandle; // reuses TunnelHandle
}

interface ServiceProjectionManager {
  bind(service: DiscoveredService): Promise<Projection>;
  unbind(id: string): Promise<void>;
  status(): Projection[];
  on(event: 'change', cb: (p: Projection[]) => void): void;
}
```

- **SshReverseTunnel** implements `Transport` by generalizing `openReverseTunnel` (drop the Flutter-specific naming; keep `buildReverseTunnelArgs`, the `127.0.0.1:remote:127.0.0.1:local` bind, `ExitOnForwardFailure`, `BatchMode`, `accept-new`). Reuses the project's provisioned SSH key/host/port/user.
- **Supervision** — each tunnel is supervised; on unexpected ssh exit while the service should be active, reconnect with exponential backoff (cap, e.g. 30s). Status transitions: `binding → active`, `active → reconnecting → active`, give-up → `failed`.
- **Same-port mirroring** — on `bind`, attempt `remotePort = localPort`. `ExitOnForwardFailure=yes` makes ssh exit non-zero if the remote port is taken; on that specific failure, allocate a free remote port and retry, set `mirrored = false`, and record the actual `remotePort`. The MCP registry and manifest always reflect the *actual* remote port.
- **Staleness** — if a discoverer reports a previously-bound service has vanished (container stopped, VM Service gone), the manager tears its tunnel down and marks the projection `stale`.

### 4. Layered projection outputs

- **Same-port mirror** (ergonomic layer) — see manager above. Makes unchanged `localhost` connection strings work on the remote.
- **MCP services registry** (`patchwire-services`) — an MCP server mirroring the existing Flutter MCP server pattern (`packages/cli/src/agent/flutter/mcp-server.ts`). Tools: `list_services` (label, kind, host `127.0.0.1`, remotePort, connectionHint, status), `get_connection(id)`. Backed live by `manager.status()`. This is the primary runtime-discovery path for the remote agent.
- **Manifest** (`~/patchwire/<project>/.patchwire/services.json`) — written `0o600`, updated on every projection change. Same fields as the MCP registry. Fallback/debug artifact the agent (or a human) can `cat`.

### 5. CLI surface (Phase 1)

- `patchwire services discover` — run discoverers, print candidates (id, label, kind, localPort, hint).
- `patchwire services bind <id|port> [--label]` — confirm + bind one service; print resulting remotePort + mirrored flag.
- `patchwire services unbind <id>` — tear down one binding.
- `patchwire services status` — print live projection table.

These drive the full discover→tunnel→mirror→manifest→MCP loop headless, enabling real E2E validation before any GUI.

## Security

- **Loopback only.** Remote forward binds `127.0.0.1:remotePort` — never `0.0.0.0`, never a tailnet address. Only processes on the agent host (the remote Claude Code) can reach a bound service.
- **Reuse provisioned credentials.** SSH key, host, user, port come from the existing project connection record. `BatchMode=yes`, `ExitOnForwardFailure=yes`, `StrictHostKeyChecking=accept-new`.
- **No credential leakage.** Connection hints reference `127.0.0.1` only and carry no passwords. The manifest is `0o600`. Service ports and labels may be logged; raw DB credentials are never logged.
- **Confirm before bind.** Nothing is exposed without an explicit confirm step (CLI prompt in P1).
- **Bounded lifetime.** Tunnels are torn down when the project workspace closes and when a service goes stale.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| ssh tunnel drops unexpectedly | Supervisor reconnects with exponential backoff; status `reconnecting`; surfaced via manager event / MCP / manifest |
| Remote port already in use (mirror) | `ExitOnForwardFailure` → allocate free remote port, `mirrored=false`, record actual port |
| Docker not running | Discovery returns `[]`; no error |
| Container / VM Service disappears | Projection marked `stale`, tunnel torn down |
| Reconnect attempts exhausted | Status `failed`; left visible for the developer to retry |

## Testing

**Unit (fakeable, no network):**
- DockerDiscoverer: parse `docker ps` JSON fixtures → correct kind/label/hint; Docker-down → `[]`.
- DartDiscoverer: VM Service URI parsing (reuse existing `flutter-vmservice` tests as reference).
- Mirror/conflict logic: port-taken fixture → fallback port + `mirrored=false`.
- Manifest writer: correct shape, `0o600`.
- Manager state machine: drive via the existing `TunnelSpawn` fake-spawn seam; assert status transitions on open/drop/reconnect/unbind.

**Integration (real ssh, gated):**
- Start a local Postgres in Docker, `patchwire services bind`, assert the remote host can `psql 127.0.0.1:<remotePort>` and reach it.
- Assert the `patchwire-services` MCP `get_connection` returns the correct, reachable connection string.
- Drop the tunnel; assert auto-heal returns status to `active`.

Mirror the existing `flutter-tunnel.test.ts` / `flutter-vmservice.test.ts` patterns.

## Roadmap (specced separately)

- **P1 (this spec)** — core engine + discoverers + manager + same-port mirror + MCP registry + manifest + CLI. Internal validation via real E2E on a host.
- **P2** — Desktop "Services" panel in the Workspace screen (discover list, confirm/bind toggles, live status, connection hints). First public release. New IPC commands over the same core.
- **P3** — VS Code extension port-forwarding panel, a thin client over the identical core engine.

## Files (Phase 1, indicative)

- `packages/cli/src/lib/reverse-tunnel.ts` — generalized from `flutter-tunnel.ts` (or `flutter-tunnel.ts` re-exports from it to avoid breaking the Flutter path).
- `packages/cli/src/services/discoverers/docker.ts`, `dart.ts`, `types.ts`
- `packages/cli/src/services/manager.ts` — ServiceProjection manager + SshReverseTunnel transport
- `packages/cli/src/services/manifest.ts`
- `packages/cli/src/agent/services/mcp-server.ts` — `patchwire-services` MCP
- `packages/cli/src/commands/services.ts` — CLI subcommands
- Tests alongside each, mirroring existing layout under `packages/cli/test/`.
