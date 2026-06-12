# Patchwire Agent & Protocol Specification

**Date:** 2026-06-12
**Status:** Approved with minor revisions (incorporated below)
**Owner:** rebin
**Parent:** [`../patchwire-v2-product-architecture-strategy.md`](../patchwire-v2-product-architecture-strategy.md)
**Related:** [`2026-05-25-push-local-folder-bootstrap-design.md`](2026-05-25-push-local-folder-bootstrap-design.md) (current bootstrap), [`2026-05-20-vscode-extension-v2-design.md`](2026-05-20-vscode-extension-v2-design.md)

This is the first real implementation spec spawned by the v2.0 parent architecture. It defines the **agent (server side)** and the **Patchwire Protocol** that every client speaks. It is the foundation the Core and Projection specs build on; getting the seams right here is what keeps those specs from forcing a protocol rewrite later.

## Scope

In scope:

1. **`ServerPlatform`** — the capability interface every OS-specific agent behavior routes through, plus the macOS implementation and the detection mechanism.
2. **Provisioning state machine** — zero-touch detect → plan → consent → execute → verify, with rollback via compensating actions.
3. **Protocol v2** — the message envelope, capability handshake, transport split (HTTP commands + duplex WebSocket events), and the event taxonomy.
4. **Multi-AI session model** — session states, the worktree lifecycle, archive/retention, and audit.

Out of scope (delegated): the Linux and Windows implementations of egress/service/secrets (S2/S3 specs); the client-side Core (`@patchwire/core`) spec; the projection rule engine and policy language (Projection spec). This spec defines the **interfaces and the macOS implementation**, not the other OSes.

## Non-goals (deliberately not in this spec)

This protocol stays aligned with the existing stack: **Fastify, HTTP, NDJSON, WebSocket.** We explicitly do **not** introduce gRPC, event sourcing, Kafka, or a message bus. Those are not needed for the multi-session, governance-push future and would pull the implementation away from the working code. If a future scale need arises, it gets its own spec; it is not assumed here.

---

## Pillar 1 — `ServerPlatform` capability interface

Every `darwin`-gated behavior in today's CLI (`egress.ts`, `keychain.ts`, `daemon.ts`, the session launcher) routes through one interface. Implementations are selected by **capability detection over the bootstrap SSH session**, never by a bare `process.platform` check in business logic.

### Capability descriptors (revision 7)

Capabilities are **descriptors, not raw strings**, because a capability is not its implementation: two Linux hosts may both provide "egress" through different mechanisms and versions (Ubuntu/Fedora nftables, a hardened-enterprise custom firewall, a container with none). Encoding only the string `'nftables'` throws away the information a future implementation or a policy check needs.

```ts
interface CapabilityDescriptor {
  /** What the capability is implemented by, e.g. 'seatbelt' | 'nftables' | 'firewall' | 'none'. */
  type: string;
  /** Implementation/protocol version, when meaningful (e.g. nftables ruleset schema). */
  version?: string;
  /** True if applying this capability needs sudo/admin (drives the consent step). */
  requiresElevation: boolean;
}
```

### Interface

```ts
type OsKind = 'macos' | 'linux' | 'windows';

interface ServerPlatform {
  readonly os: OsKind;
  readonly arch: string;            // 'arm64' | 'x64' | ...
  readonly pathStyle: 'posix' | 'win';

  readonly capabilities: {
    egress: CapabilityDescriptor;             // type: 'seatbelt'|'nftables'|'firewall'|'none'
    filesystemIsolation: CapabilityDescriptor;// type: 'seatbelt'|'namespaces'|'none' — parallel to egress; enforces projection (see Projection spec)
    secrets: CapabilityDescriptor;            // type: 'keychain'|'file'|'libsecret'|'dpapi'
    service: CapabilityDescriptor;            // type: 'launchd'|'systemd-user'|'systemd-system'|'windows-service'
    shell: CapabilityDescriptor;              // type: 'zsh'|'bash'|'pwsh'
    packageManager: CapabilityDescriptor;     // type: 'brew'|'apt'|'winget'|'manual'
  };

  // Behaviors (each returns typed results; never throws raw):
  installPlan(): ProvisionPlan;
  serviceInstall(unit: ServiceSpec): Promise<StepResult>;
  serviceStart(): Promise<StepResult>;
  serviceStop(): Promise<StepResult>;
  secretsPut(key: string, value: string): Promise<StepResult>;
  secretsGet(key: string): Promise<string | null>;
  egressApply(policy: EgressPolicy): Promise<StepResult>;
  sessionLaunch(spec: SessionLaunchSpec): Promise<SessionHandle>;
}
```

### Detection

Detection runs once at connect over SSH and is cached on the workspace record, then re-verified by `doctor`:

1. Probe OS + arch: `uname -sm` (POSIX) / `ver` + `echo %PROCESSOR_ARCHITECTURE%` (Windows).
2. Feature-probe each capability: presence of `sandbox-exec` / `nft` / `sc.exe`; which service manager is live (`launchctl`, `systemctl --user`, Windows SCM); which package manager exists; whether elevation is obtainable (can we `sudo -n true` / are we an admin).
3. Build the `capabilities` object with descriptors, including `requiresElevation` per capability.

The macOS implementation wraps the existing code: `egress` → `sandbox-exec`/seatbelt (`egress.ts`), `secrets` → Keychain (`keychain.ts`), `service` → launchd (`daemon.ts`), `shell` → zsh launcher (`sessionTerminal` remote command). Linux/Windows implementations are stubs that report `type:'none'` / `requiresElevation` until their S2/S3 specs land — and the agent **fails closed or warns explicitly** when `egress.type === 'none'`, never silently.

---

## Pillar 2 — Provisioning state machine

Zero-touch provisioning over the bootstrap SSH connection. Built on the existing `bootstrap-snapshot.ts` step/error-code/typed-progress pattern, extended with a consent gate and rollback.

```
detect → plan → consent → execute → verify
                              │
                          (on failure)
                              ↓
                          rollback (compensating actions)
```

- **detect** — run Pillar 1 detection; produce the `capabilities` object.
- **plan** — compute the `ProvisionPlan`: ordered steps (install Claude Code, install Mutagen via the resolver, write secrets, install + start service, apply egress, bind tailnet, set token), each annotated with `requiresElevation`.
- **consent** (privilege model) — present the plan to the client, highlighting which steps need elevation and **what each elevation buys** (e.g. "admin → enforced default-deny egress; without it → egress warn-only"). The user approves, declines individual elevations (degraded-but-explicit), or cancels.
- **execute** — run steps in order. **Each successful step registers a compensating action** (revision 2). Steps emit `provision.step` events.
- **verify** — end-to-end `doctor`, including a live egress probe (reuse `runEgressProbe`), service-health check, and a protocol handshake against the freshly installed agent.

### Rollback via compensating actions (revision 2)

We do not attempt transactional installs. Instead each step contributes an **inverse**:

| Step | Compensating action |
|---|---|
| install Mutagen (downloaded) | remove downloaded binary |
| write secret | delete secret entry |
| install service | stop + uninstall service |
| apply egress | remove the ruleset / restore prior |
| bind tailnet | leave/release the binding |

On a step failure, the machine enters **rollback** and runs the registered compensations **in reverse order**, emitting `provision.step` events for each, then surfaces a `provision.completed` with `status: 'rolled-back'` and the failing step. This matters most on Windows, where a half-applied firewall + service leaves the box in a confusing state. Rollback is best-effort and idempotent; a compensation that fails is logged, never fatal.

---

## Pillar 3 — Protocol v2

### Transport split

- **HTTP + bearer** for request/response **commands**: `provision.*`, `ask`, `chat`, session CRUD, `me`, `queue`, `health`. Reuses today's Fastify server and auth middleware.
- **One authenticated duplex WebSocket per client** for **server-push events**: events from *other* concurrent sessions, policy/projection updates, usage/budget ticks, and provisioning progress. The WS authenticates with the same bearer token on connect and carries the same envelope.

### Message envelope

Every message — command, response, event, provisioning, usage, audit — carries:

```ts
interface Envelope {
  protocolVersion: '2';
  requestId: string;          // uuid — revision 1; correlates command↔response↔events↔audit
  identity: Identity;         // revision 4 + 7
  workspaceId: string;
  sessionId?: string;         // present for session-scoped messages
}

interface Identity {          // locked into v2 now (revision 4) to avoid a v3 identity rewrite
  issuer: string;             // who minted the credential (the agent/workspace authority)
  subject: string;            // the acting principal; = workspace owner today
  type: 'workspace' | 'user' | 'service';
}
```

- **`requestId`** (revision 1) is on **everything**. A command, its streamed responses, every event it triggers, the usage tick it produces, and the audit record all share one `requestId`. This is the single cheapest thing that makes the system debuggable, traceable, and auditable later.
- **`identity.type`** (revision 4) is locked now even though only `'workspace'` is issued today. `'user'` and `'service'` are reserved so introducing per-user and service-account credentials later is additive, not a breaking v3.

### Capability handshake

On connect, before any command, server and client negotiate (revision 6 / the explicit addition):

```jsonc
// Server → Client
{ "protocolVersions": ["1", "2"],
  "capabilities": { "egress": "seatbelt", "multiSession": true, "policyPush": true, "usageTicks": true } }

// Client → Server
{ "protocolVersion": "2" }
```

This lets old clients talk to new agents and new clients talk to old agents during the strangler migration: each side picks the highest mutually-supported version and only uses advertised capabilities. An agent that does not advertise `multiSession` is driven in single-session mode by a v2 client.

### Event taxonomy (revision 3)

Events are namespaced so names do not sprawl. Five families:

| Family | Events |
|---|---|
| **session** | `session.created`, `session.started`, `session.completed`, `session.failed` |
| **policy** | `policy.updated`, `projection.updated` |
| **usage** | `usage.tick`, `budget.exceeded` |
| **provision** | `provision.step`, `provision.completed` |
| **audit** | `audit.recorded` |

The existing `chat_*` and `sync_*` `CliEvent` members carry over (a session emits them on its own stream); the taxonomy above is the new server-push layer over the WebSocket. New event types must fit an existing family or justify a new one in this spec.

### Backward compatibility

`SUPPORTED_PROTOCOL` goes `'1' → '2'`. v1 HTTP routes (`/ask`, `/chat`, `/session/*`) remain mounted and functional throughout the strangler migration; v2 is **additive** (new envelope fields are optional to a v1 reader, the WS channel is opt-in via the handshake). No flag day.

---

## Pillar 4 — Multi-AI session model

A workspace hosts multiple concurrent AI sessions, each isolated, scoped to its projection view, and fully audited.

### Explicit session states (revision 5)

```ts
enum SessionState {
  Created,           // record exists, nothing provisioned yet
  Preparing,         // worktree/branch being cut, provider warming
  Running,           // provider executing
  WaitingForReview,  // output sits on the branch awaiting integration
  Completed,         // integrated (or explicitly accepted)
  Cancelled,         // user/policy cancelled
  Failed,            // provider or infra error
}
```

These states drive audit, the client UI, the WebSocket `session.*` events, and any future control plane for free. State transitions emit `session.*` events carrying the `requestId` that created the session.

### Worktree lifecycle

- `session.create {provider, policyRef, worktreeRef}` cuts a git **worktree + branch `pw/session/<id>`** from workspace HEAD (`Preparing`).
- The provider runs scoped to its projection view (`Running`); output lands only on that branch, so concurrent agents never race on files. The existing semaphore/concurrency primitives gate provider execution.
- When the provider finishes, the session enters **`WaitingForReview`**. Integration is **explicit and reviewable** — the branch surfaces as a reviewable diff that a human (or, later, a policy) integrates deliberately. Auto-merge is a future optimization, not v2 behavior.

### Archive + retention, not prune (revision 6 in the user's list)

**Session close does NOT delete the worktree.** Closing a session enters **archive**; a **retention policy** later reclaims it:

```
session close → archive → (retention policy) → cleanup
```

Default retention is configurable (e.g. 7 / 30 days / manual); the spec only mandates that **session end is decoupled from branch deletion**. The motivating case: Claude generates code, the user closes the session intending to review tomorrow — the work must still be there tomorrow. Cleanup is a separate, policy-driven sweep, never a side effect of closing.

### Audit

Every session operation is stamped with `identity.subject`, `identity.type`, `sessionId`, and `requestId`, appended via the existing `audit-log.ts`. There is no anonymous AI activity. `audit.recorded` events mirror writes to subscribed clients.

---

## Strangler reuse map

| Existing code | v2 role |
|---|---|
| `lib/bootstrap-snapshot.ts` | provisioning state machine (extend with consent + rollback) |
| `agent/egress.ts` | macOS `egress` capability impl |
| `agent/keychain.ts` | macOS `secrets` capability impl |
| `commands/daemon.ts` | macOS `service` capability impl |
| `agent/server.ts` (Fastify + bearer) | HTTP command surface; add WS channel + envelope |
| `agent/session-store.ts` | extend with `SessionState`, worktree ref, identity |
| `agent/audit-log.ts` | stamp identity + requestId; emit `audit.recorded` |
| usage/cost accounting (`agent/usage*.ts`, `pricing.ts`) | source of `usage.tick` / `budget.exceeded` |
| `@patchwire/protocol` | add `Envelope`, `Identity`, handshake, event taxonomy; bump `SUPPORTED_PROTOCOL` |

## Mapping to migration phases

This spec is the substance of **S1** (the `ServerPlatform` seam + provisioning pipeline + protocol v2 + session model), implemented with the **macOS** capability set so it ships against a Mac server first. **S2 (Linux)** and **S3 (Windows)** then add their capability implementations behind the interface defined here, without touching the protocol.

## Open questions (tracked, not blocking)

- WebSocket reconnect/resume semantics (event replay window vs. re-sync on reconnect).
- Worktree integration UX detail (lives partly in the Core/UI and Projection specs).
- Exact retention defaults and where the sweep runs (agent cron vs. on-connect).
- Budget-enforcement point precision (`budget.exceeded` as soft warn vs. hard stop) — coordinated with the Projection/policy spec.

## References

- Parent: `docs/patchwire-v2-product-architecture-strategy.md`
- Current protocol: `packages/protocol/src/events.ts`, `packages/cli/src/agent/server.ts`
- Current bootstrap: `packages/cli/src/lib/bootstrap-snapshot.ts`
