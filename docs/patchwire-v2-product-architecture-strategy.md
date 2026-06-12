# Patchwire v2.0 — Product Architecture & Technical Strategy

| | |
|---|---|
| **Status** | Proposed — for alignment, not yet committed to implementation |
| **Document owner** | Patchwire Core Team |
| **Date** | 2026-06-12 |
| **Supersedes** | The implicit architecture of the 0.3.x extension-centric product |
| **Build posture** | Strangler-fig evolution of the current monorepo (not a clean-room rebuild) |

## How to read this document

This is a layered document. Three readers, three depths:

- **Layer 1 — Vision & Strategy** (everyone): what Patchwire is, the problem, the bet, the non-goals.
- **Layer 2 — Architecture** (engineers, architects): the capability-based model, the client/server seams, the security model, the provisioning flow.
- **Layer 3 — Technical Seams & Child Specs** (implementers): where the current code is reused, what the adapter interfaces look like, and the three specifications this document spawns.

It is a strategy document, not an implementation plan. It defines the shape we are building toward and the order we approach it. Each phase below becomes its own spec → plan → implementation cycle. Nothing here authorizes code; it authorizes the next round of specs.

---

# Layer 1 — Vision & Strategy

## Executive summary

Patchwire is a **local-first workspace projection platform**. Users work in a local editor while execution, credentials, repositories, and AI agents stay on a machine the user or organization controls.

The one-line principle: **work locally, execute remotely.**

Today Patchwire ships as a VS Code extension plus a CLI that pushes a project to a remote Mac, runs Claude Code there, and pulls back a reviewable diff. v2.0 keeps that working product alive and grows it into a platform that runs on any client OS, provisions any server OS over SSH, controls what AI agents can see, and records everything they do.

**The deeper positioning:** Patchwire is no longer primarily a developer tool. It is becoming **workspace governance infrastructure for AI-enabled organizations** — the layer that decides what code, credentials, and infrastructure each user and each AI agent may touch, and that records what they did. Developers are simply the first users. This distinction is not cosmetic; it changes roadmap priorities (governance and audit move forward), pricing (per-seat developer tooling versus per-organization infrastructure), enterprise conversations (security and compliance lead, not features), and what we treat as the core. The document below is written from that stance.

## Problem statement

Remote development today forces a bad trade between developer experience and control.

- **Plain SSH** is terminal-centric, has rough onboarding, awkward file sync, and no real AI story.
- **Remote Desktop / VDI** is heavy, high-latency, and resource-hungry.
- **VS Code Remote-SSH** keeps files remote, so local tooling and local AI cannot reach them, and gives organizations little control over what those tools access.
- **AI access is ungoverned.** Organizations increasingly want centralized AI accounts, credentials, and repositories with controlled access to sensitive assets. Current tools expose the whole repository to whatever agent is running.

Patchwire's wedge is the gap none of these close: a local-feeling workflow where the organization still decides what code, secrets, and infrastructure each user and each AI agent can touch.

## Vision

Patchwire becomes the layer between users, workspaces, AI agents, and infrastructure. It projects a controlled view of remote resources into a local environment. The user gets a local workflow; the organization keeps centralized control.

## Product principles

- **Local first.** Everything should feel local.
- **Remote execution.** Execution stays remote whenever possible.
- **Security by default.** Secure defaults with minimal user configuration.
- **Capability-based, never OS-based.** We design around capabilities a host can provide (run a service, enforce egress, store a secret), not around operating systems. An OS is a set of capability implementations.
- **AI-aware.** AI access is controllable and auditable from the start.
- **Enterprise-ready seams.** Multi-user, multi-team, multi-workspace are design constraints from day one, even before the features ship.
- **Control-plane-optional.** A workspace must execute fully — connect, sync, run AI sessions, enforce policy, audit — without any centralized Patchwire service. A future Patchwire Cloud or Enterprise control plane may add fleet management, identity, and reporting on top, but it is never on the critical path for a single workspace to function. This principle is stated explicitly so future engineers do not accidentally make cloud services mandatory.

## The v2.0 bet

The flagship of v2.0 is two things working together, with a third as the long-term differentiator (see *Moat evolution* for how these stack into a durable, ecosystem-based moat):

1. **Cross-platform parity + zero-touch provisioning** (near-term flagship). Any client OS to any server OS, with install-and-go SSH provisioning and portable security defaults. This is reach and onboarding.
2. **AI access control & audit** (near-term flagship). Centralized, policy-driven, auditable AI and credential access. This is the enterprise wedge.
3. **Workspace Projection Engine** (long-term differentiator). Per-file, per-AI visibility — allow, hide, redact, transform, virtualize. This is the capability competitors cannot copy by adding a flag, and the switching-cost core that the durable ecosystem moat is built on.

Parity and audit get users in the door and give organizations a reason to standardize on Patchwire. Projection is what makes leaving expensive.

## Non-goals

Patchwire is **not** a VPN, a remote desktop, a code editor, an AI provider, or a cloud hosting platform. It integrates with these; it does not replace them. Stating this prevents the most likely failure mode: rebuilding "VS Code Remote-SSH with extra steps."

## Patchwire vs. Remote-SSH (the drift test)

The single biggest risk to this program is building something that, viewed from a distance, is Remote-SSH with a file-sync bolt-on. Every architectural decision should be checkable against this table. If a proposed feature moves a row back toward the middle column, it is drift.

| Dimension | Remote-SSH (the trap) | Patchwire v2.0 (the target) |
|---|---|---|
| Source of truth | Remote files, opaque to local tooling | Remote is authoritative; local is a **projection** of it |
| File access | Files remote; local tools/AI can't reach them | Local tools and local AI work against a materialized local view |
| What an AI agent can see | The whole repository | Only the **policy-allowed projection** for that agent |
| Multiple AI agents | Unmanaged; share one shell | Isolated **sessions**, each with its own view, branch, and audit trail |
| Provisioning | Manual server setup, per-OS by hand | Detect → plan → install → secure → verify, in one click |
| Egress / security | Whatever the box happens to allow | Default-deny egress where the OS supports it; explicit when it can't |
| Audit | Shell history, if that | Every operation recorded by the agent (system of record) |
| Conflict handling | Last write wins, silent loss | Conflicts quarantined and surfaced as reviewable diffs |
| Governance | None | Workspace ownership, per-user and per-AI policy, isolation |

Remote-SSH exposes a machine. Patchwire projects a **governed view** of a machine. That is the whole difference, and it is the line the team must not cross back over.

## Target users

Individual developers, contractors and consultants, AI engineering teams, startups, and enterprises — anyone who needs centralized AI and credential management without degrading the people doing the work. Design, legal, and research teams are adjacent users who benefit from the same projection and audit controls.

## Moat evolution

The moat is not a single feature. It is built in phases, and the durable layer is the last one, not the first. Each phase earns the right to the next.

- **Phase 1 — Zero-touch onboarding gets adoption.** Any-client-to-any-server provisioning with portable security defaults removes the setup wall. This is how users arrive, but it is the most copyable layer and never the moat by itself.
- **Phase 2 — Centralized AI governance gets organizational buy-in.** Once an organization routes its AI accounts, credentials, and access policy through Patchwire and wires the audit log into its compliance process, the buyer shifts from the developer to the org. This is where Patchwire stops being optional.
- **Phase 3 — Workspace projection creates switching cost.** Per-file, per-AI visibility requires owning the layer between the remote workspace and what each consumer sees — something Remote-SSH, VDI, and editor-remote modes cannot retrofit without becoming a different product. Once an org's policies are expressed as projections, leaving means re-deriving them elsewhere.
- **Phase 4 — Ecosystem becomes the durable moat.** The lasting defensibility is the ecosystem that accretes on top of Core: AI-provider adapters, device adapters, policy libraries, and integrations. The more agents, providers, and policies that target Patchwire, the more costly it is to leave, and the more every new integration benefits every user.

The historical pattern is clear: **Docker's moat was never containers, GitHub's was never Git, and Tailscale's is not WireGuard.** In each case the underlying technology was commoditizable; the durable advantage was ecosystem and adoption. Patchwire's projection and governance are what get the ecosystem started — but the ecosystem is the moat.

---

# Layer 2 — Architecture

## Shape: one core, two peer clients, one agent

```
   CLIENT (any OS)                                       SERVER (any OS)
┌───────────────────────┐                          ┌──────────────────────────┐
│  Desktop app  ─┐       │      Patchwire Protocol  │   Patchwire Agent          │
│  VS Code ext  ─┼─ Core │ ───────────────────────> │   (system of record)       │
│  CLI          ─┘  +    │   (SSH = bootstrap only) │   • execution / AI routing │
│   HostPlatform adapter │ <─────────────────────── │   • ServerPlatform adapter │
└───────────────────────┘   streams / policy / logs └──────────────────────────┘
```

Desktop and the VS Code extension are **peer clients over one shared core**. We invest in the core and protocol first and build whichever client the market pulls hardest. The CLI remains a first-class client and the substrate the others reuse. The **Agent is the system of record**: it owns execution, AI routing, security enforcement, and the audit log.

## Patchwire Core

"Core" is named throughout this document, so it must be defined precisely. **Patchwire Core is the client-side, UI-agnostic library that every client embeds.** Desktop, the VS Code extension, and the CLI are thin shells around it. Core is where the product logic lives so that it lives exactly once.

Core owns:

- **Connection and session lifecycle** — opening, authenticating, and maintaining the protocol connection to an agent; tracking active AI sessions.
- **Protocol client** — speaking the Patchwire Protocol (evolved from today's `@patchwire/protocol` NDJSON types).
- **Projection application** — materializing the agent's authoritative workspace into the local view according to policy, and routing local edits back as intent.
- **Sync orchestration** — driving the sync engine via the `HostPlatform` adapter and surfacing conflicts.
- **Policy cache and enforcement hints** — holding the policy set so clients can render what is allowed without round-tripping.
- **Local cache** and the **`HostPlatform`** adapter (sync engine resolution, clipboard, tooling discovery, patch normalization).

Core does **not** own UI, rendering, or editor integration. A client contributes only its surface: panels, commands, and user intent. This boundary is what makes "two peer clients" real rather than aspirational — if logic creeps into a client, the other client diverges, and the platform fractures.

Packaging: Core is a TypeScript package (`@patchwire/core`) reused directly by the extension and CLI, which are already Node/TypeScript. The Desktop client consumes Core through an embedded Node runtime (sidecar process or binding); how Desktop hosts Core is an explicit open question delegated to the **Patchwire Desktop Architecture Specification**.

## Workspace ownership model

A **Workspace** is the unit of ownership, access, and isolation. It binds together: an **owner**, a **server/agent**, a **project root** (the repository or directory under management), a **policy set**, a set of **authorized users**, and a set of **authorized AI providers**.

- **Owner** is a user or an organization. In single-user mode the owner is the user; in multi-tenant mode an organization owns the workspace and grants access to users under roles (RBAC, a later phase). Ownership is transferable from a user to an organization, which is the path a solo project takes when a team forms around it.
- **Authorized users** get access to a workspace through the owner; access is per-workspace, not global to the server.
- **Authorized AI providers** are attached per workspace, each carrying its own projection policy (see the session model below).
- **Isolation** is a hard boundary: one workspace cannot read another's files, secrets, or sessions, even on the same server. This is security layer 3 and a precondition for hosting multiple owners on one agent.
- **Quotas** (sessions, storage, compute) attach to the owner and are an enterprise-phase concern, but the ownership model is designed so they can be added without reshaping it.

This model exists from day one even while the product is single-user, because retrofitting ownership onto a system that assumed one user is the kind of rework this document is meant to prevent.

## Source of truth

This is the most important definition in the document, because getting it wrong is exactly how the product drifts into Remote-SSH-with-file-sync.

**The agent's workspace is the source of truth. The local machine holds a projection of it, not a peer copy.**

Concretely:

- The **committed state of the workspace lives on the remote agent.** Git history, files created by AI agents, deletions, and build artifacts are all authoritative there. The agent is the system of record.
- The **local view is a materialized projection** — filtered by policy, possibly redacted or virtualized, and reconstructable at any time. Losing the local copy loses nothing that matters; it can be re-projected from the agent.
- The **one thing the local side is authoritative for** is un-pushed local edits in flight. A developer's local change is "pending intent" that flows to the agent and becomes truth once accepted. Until then it is the only place that change exists, so it is protected, not overwritten.

We are not synchronizing two equal copies of a repository. We are projecting an authoritative remote into a governed local view and flowing local intent back into it. Every sync and conflict decision below follows from that asymmetry.

## Sync and conflict strategy

Because the remote is authoritative and the local side also produces edits, the two diverge whenever both change the same path between syncs — most commonly when a developer edits locally while an AI agent edits the same file on the remote. The strategy has to guarantee one thing above all: **no silent data loss.**

- **Clean changes propagate.** If only one side changed a path, the change flows. The current implementation already leans this way: rsync runs with `--update` (never overwrite a destination that is newer) specifically so an agent's fresh remote edit is not clobbered by a stale local copy. Mutagen, the v2 engine, provides real bidirectional change detection rather than this one-directional guard.
- **True conflicts are quarantined, never resolved silently.** When both sides changed a path, Patchwire does not pick a winner. It quarantines the conflict and surfaces it in the client as a **reviewable diff** — which is the product's existing DNA (push a change, review a unified diff). The user resolves it deliberately.
- **Projection constrains write-back.** Hidden, redacted, and virtualized paths are **read-only projections** and are never authoritative. A redacted local value must never be written back over the real remote secret. The projection engine therefore participates in conflict resolution: non-authoritative paths are excluded from the write-back set entirely, which also closes a serious data-exfiltration and corruption hole.
- **Deletes are conservative.** Mirroring today's deliberate omission of rsync `--delete`, deletions do not propagate automatically across the boundary; they become explicit operations, so an agent's new file is never destroyed by a sync.

The policy in one line: **remote-authoritative, local-edits protected, conflicts surfaced as diffs, projected paths never written back.**

## Offline behavior

The source-of-truth model already implies the answer to "what happens when the laptop loses the network," and the document should state it rather than leave it for engineers to improvise. **Offline mode is a deferred-intent queue, not a second authority.**

- The developer can keep editing the locally-cached projection. Those edits are exactly what the model already calls **pending intent** — they accumulate in a local queue instead of failing.
- Paths that are not locally cached are **read-only** while offline, because the authoritative copy is unreachable and Patchwire will not fabricate one.
- On reconnect, the queued intent flows to the agent and reconciles through the **normal conflict path** — clean changes propagate, true conflicts surface as reviewable diffs. Offline introduces no new merge semantics; it just widens the window in which divergence can occur.

This keeps the asymmetry intact: going offline never promotes the local copy to a source of truth. It only defers the moment intent reaches the truth. Full offline design (cache scope, queue durability, eviction) is a later concern; the architectural commitment is the deferred-intent-queue model, not read-only lockout.

## Multi-AI session model

A workspace can host **several AI sessions at once**, possibly from different users and different providers (Claude Code, Gemini CLI, Codex, and so on). The session is the unit of execution, isolation, and audit.

- A **session** is the tuple *(provider adapter, user, workspace, policy-scoped view, lifecycle)*. Each session carries its own audit trail; the agent records which session did what.
- **Per-AI projection.** Each session sees only its policy-allowed view of the workspace — Claude Code may see `src` and `docs`, a documentation agent only `docs`. The projection engine enforces this per session, not globally, so two agents in the same workspace can legitimately have different visibility.
- **Concurrency isolation via worktrees.** Concurrent agents must not race on the same files. The model is **one git worktree/branch per session on the remote**, so each agent works in isolation and its output is merged deliberately (and reviewably) rather than interleaved. This reuses git-on-the-remote, which is already where history lives, and it fits the reviewable-diff workflow. The CLI's existing concurrency and semaphore primitives provide the coordination substrate.
- **Routing and accountability.** The agent routes each session to its provider adapter (execute / stream / cancel / capabilities / policy-validation) and stamps every operation into the audit log against the session identity. There is no anonymous AI activity.

This is the concrete mechanism behind "AI-aware infrastructure": multiple agents, each scoped to what it may see, each isolated from the others, each fully accountable.

## Capability-based platform model

Two adapter layers replace every hardcoded OS assumption. Each is a small interface with one implementation per OS, selected by capability detection rather than `if (platform === 'darwin')`.

**`HostPlatform`** (client side) provides:

- Sync engine resolution (`resolveMutagen()`: PATH → bundled → checksum-verified download into `~/.patchwire/bin`).
- Clipboard capture (macOS `pngpaste`/`osascript`, Windows PowerShell, Linux `xclip`/`wl-paste`).
- Tooling discovery (e.g. Tailscale, which is not on PATH on Windows).
- Patch line-ending normalization (CRLF safety on Windows round-trips).

**`ServerPlatform`** (agent side) provides, behind a `capabilities` object detected over the bootstrap SSH connection:

| Capability | macOS (today) | Linux (target) | Windows (target) |
|---|---|---|---|
| Egress sandbox | `sandbox-exec` + seatbelt | nftables / netns / `bwrap` | WFP / firewall, or warn-only at first |
| Secrets at rest | Keychain | file (mode 600) / libsecret | DPAPI / Credential Manager |
| Service | launchd plist | systemd user unit | Windows Service / Scheduled Task |
| Interactive session | `exec zsh -lic claude` | bash login shell | PowerShell launcher |
| Package install | brew | apt / curl | winget / PowerShell |
| Path model | POSIX | POSIX | drive letters, backslashes |

The honest constraint, stated up front: **the security guarantee is not uniformly portable.** The default-deny egress sandbox — Patchwire's strongest claim — exists because of macOS seatbelt. Linux is achievable with nftables or network namespaces. Windows egress sandboxing is hard and may ship as "degraded / warn-only" first. The `capabilities.egress` flag makes this explicit so the agent can **fail-closed, or warn loudly, never silently downgrade.**

## Patchwire Protocol

SSH is **bootstrap only** — used to detect the platform, install the agent, and exchange keys. Once provisioned, the client and agent speak the Patchwire Protocol: authentication, workspace sync, streaming logs, AI communication, and policy synchronization. This is an evolution of the existing HTTP/NDJSON protocol in `@patchwire/protocol`, not a net-new wire format. Transport options grow over time: today the tailnet (Tailscale); later direct TCP, WireGuard, HTTPS, and enterprise gateways.

## Workspace Projection Engine (the switching-cost core)

The core innovation, sequenced after parity and audit land. Instead of exposing the whole repository, a projection sits between the remote workspace and the local one:

```
Remote workspace  →  Projection Engine  →  Local workspace (and per-AI views)
```

Projection rules per path: **allow, hide, redact, transform, virtualize.** Examples: `.env` → hide (invisible to local machine and AI); AWS credentials → redact (structure visible, values masked); generated assets → transform (compressed representation).

The same engine powers **per-AI visibility**: Claude Code may see `src` and `docs` but not secrets or customer data; a documentation agent may see `docs` but not source. Access is policy-driven, not per-tool guesswork.

**Projection hides views, not execution.** This distinction is essential and easy to misread. Hiding `.env` from Claude does not delete it or break the build. **Hidden and redacted secrets remain fully accessible to runtime processes executing under authorized contexts on the agent**, even while they are invisible to users and AI sessions. The build runs on the remote with the real `.env`; the agent simply does not project that file (or projects a redacted form) into the human's editor or the AI's view. Projection governs who can *see* a value, not whether the *runtime* can use it. Without this rule, readers reasonably assume "hide `.env`" means "broken builds," and the whole projection model looks unusable instead of being its most valuable property.

## Security model (layered)

1. **SSH bootstrap** — provisioning only; per-project key, key-only auth, `accept-new` host keys.
2. **Patchwire authentication** — agent, workspace, and user identities; bearer-token auth on the protocol (exists today); mutual trust validation.
3. **Workspace isolation** — workspaces cannot reach one another.
4. **Policy engine** — controls user visibility, AI visibility, and file visibility.
5. **Audit log** — every operation recorded (the agent already keeps an append-only audit log).
6. **Egress controls** — allow-all / allow-list / deny-all, implemented per the host's capabilities, explicit when unavailable.

### Future governance: cost and budgets

Access control answers "what can this agent see." Organizations adopting AI at scale ask a second question at least as loudly, and usually first: **"how much did it spend?"** The ownership and session models are already the right place to answer it, so the document acknowledges the direction without committing an implementation.

A Patchwire session can expose, per session and in aggregate: **token usage, cost, runtime, model selection, and budget limits.** Those roll up along the same axes the ownership model already defines — **per user, per workspace, per organization, and per provider** — and budget limits can become an enforcement point a session checks before and during execution, recorded in the same audit log. No design is required now. The commitment is only that cost governance is a first-class future concern that the ownership, session, and audit models are deliberately shaped to support, not a bolt-on.

### Cross-cutting requirements

Cross-cutting security requirements for the public release: **tailnet-only binding is required, not optional** (the agent must not be exposed on the public internet by default); secrets at rest use the strongest store the OS offers; provisioning runs at **least privilege** and asks for elevation only when a capability (Linux nftables, Windows firewall) genuinely requires it, surfacing that request to the user.

## Provisioning experience (target: under five minutes)

1. Install a Patchwire client (Desktop or extension).
2. Add a server: host, username, SSH key.
3. Click Connect.
4. Patchwire detects the platform and capabilities, presents an **install + security plan** (including "egress sandbox: enforced / unavailable"), then installs the agent, configures the service, creates secrets, binds to the tailnet, sets the bearer token, validates security, runs diagnostics, and creates the workspace.
5. The user starts working immediately.

The user never logs into the server by hand. Everything after "Connect" is the agent provisioning itself through the bootstrap SSH session.

## Adapters on top of Core (later phases)

Two adapter families extend Patchwire without being part of its core identity. The platform's identity is **projection, governance, audit, and provisioning**; the adapters below are things built *on* that platform, and they should be understood and prioritized as such.

- **AI providers as adapters.** Each provider implements execute / stream / cancel / capabilities / policy-validation. Claude Code first; then Gemini CLI, Codex, Aider, Ollama, and others. Provider adapters are where projection policy is enforced per agent, which makes this family central to the governance story even though it is still an adapter layer.
- **Device bridge as an adapter.** Devices behind a standard interface (install, launch, stop, logs, files, port-forward, screen capture, command exec): Android, iOS, simulators, emulators, Docker containers, VMs, browsers, remote hardware. **The device bridge is an adapter built on Core, not a pillar of the platform.** It is valuable and expands the addressable use cases, but it is deliberately ranked below projection, audit, and provisioning — a feature the platform enables, not a reason the platform exists. Treating it as a peer to the governance core would distort the roadmap.

---

# Layer 3 — Technical Seams & Child Specs

## Strangler-fig: what we reuse vs. replace

v2.0 evolves the existing monorepo (`packages/{cli,extension,protocol,website}`). We do **not** discard working code. We introduce the two adapter seams and migrate behind them piece by piece, keeping 0.3.x shippable throughout.

**Reuse, wrap behind `ServerPlatform`:**

- `agent/egress.ts` (seatbelt) → becomes the macOS implementation of the egress capability.
- `agent/keychain.ts` → macOS implementation of the secrets capability.
- `commands/daemon.ts` (launchd) → macOS implementation of the service capability.
- `agent/{server,ai-runner,auth,token,audit-log,session-store}.ts` → mostly OS-agnostic; the system of record carries over with light refactoring.

**Reuse, wrap behind `HostPlatform`:**

- `sync/MutagenController.ts` + the existing `--stage-only` "external transfer" hook → Mutagen becomes the canonical cross-platform sync engine; `lib/rsync.ts` is demoted to an optional Unix fast-path.
- `lib/{ssh-runner,tailscale,patch}.ts`, `commands/push.ts` clipboard path → gain non-macOS implementations.

**Evolve in place:**

- `@patchwire/protocol` → grows auth, policy-sync, and projection messages; stays NDJSON over the tailnet initially.

## Migration phases (each phase → its own spec → plan)

- **S0 — Cross-platform client to a Mac server.** `HostPlatform` + `resolveMutagen()` + Mutagen-everywhere + papercuts (clipboard, Tailscale path, CRLF, key ACLs). Ships value immediately at lowest risk.
- **S1 — `ServerPlatform` seam + SSH provisioning pipeline.** Refactor every `darwin` gate behind the adapter; build detect → plan → execute → verify. No new server OS yet — just the seam and the zero-touch flow on macOS.
- **S2 — Linux server.** systemd service, file/libsecret secrets, **nftables egress**, apt/curl provisioning. Highest-value second server; security model is achievable.
- **S3 — Windows server.** Windows Service, DPAPI secrets, firewall egress or warn-only, winget/PowerShell provisioning, no-zsh session launcher. Hardest; egress likely degraded first.
- **S4+ — Projection, policy engine, AI-provider adapters, device bridge, enterprise (RBAC/SSO/audit export), and the eventual control plane.** Per the control-plane-optional principle, any control plane introduced here is additive: it manages fleets of workspaces and adds identity and reporting, but a single workspace must keep functioning with the control plane absent or unreachable.

Sequencing front-loads shippable value (S0), builds the seam before the expensive per-OS work (S1), and defers Windows-server's hard security problem (S3) until the abstraction is proven on Linux.

## The three child specifications

This document is the parent. It spawns three technical specs, in priority order, each driving real implementation:

1. **Patchwire Agent & Protocol Specification** (highest priority) — the `ServerPlatform` capability model, the provisioning pipeline, the protocol evolution, the multi-AI session/worktree model, and the per-OS service/secrets/egress implementations. This is first because the agent is the system of record; nothing else is real until it is defined.
2. **Patchwire Core Specification** — the UI-agnostic `@patchwire/core` library: connection/session lifecycle, projection application, sync orchestration, policy cache, the `HostPlatform` adapter, and the client/core boundary that the extension, CLI, and (later) Desktop all consume. Defining Core before Desktop prevents logic leaking into clients.
3. **Workspace Projection & Policy Engine Specification** — the projection rules, per-AI visibility, write-back constraints, the policy engine, and the audit and cost-governance model.

A **Patchwire Desktop Architecture Specification** follows these three as a downstream client spec — Desktop is a consumer of Core, so it is specified after Core, not before.

Writing the three priority specs is the next step after this document is approved. They are what determine whether the architecture described here can be built without compromising the principles it defines, and they are what prevent the team from accidentally rebuilding remote SSH with extra steps.

## Final product statement

Patchwire is a secure workspace projection platform that lets people work locally while code, credentials, AI systems, and infrastructure stay under centralized control. It lets organizations adopt AI-assisted workflows without exposing sensitive assets, compromising security, or degrading the developer experience.
