# Workspace Projection & Policy Engine Specification

**Date:** 2026-06-12
**Status:** Approved with minor revisions (incorporated below)
**Owner:** rebin
**Parent:** [`../patchwire-v2-product-architecture-strategy.md`](../patchwire-v2-product-architecture-strategy.md)
**Depends on:** [`2026-06-12-agent-protocol-spec.md`](2026-06-12-agent-protocol-spec.md), [`2026-06-12-core-spec.md`](2026-06-12-core-spec.md)

The Projection & Policy Engine is the v2.0 long-term differentiator: per-file, per-AI, per-user control over what each consumer of a workspace may see, and how. The Agent spec (`policy.update` / `projection.update` events, `session.create.policyRef`) and the Core spec (`projectionVersion`, read-only enforcement, compiled-projection consumption) both reference this engine and deliberately left it to be defined here. This spec closes the loop.

## Scope

In scope: the **rule language** (declarative, evolving `patchwire.yml`), the **policy composition model** (how layers combine), **compilation and versioning** (producing the `projectionVersion` the other specs consume), the **projection security model** (how redaction is enforced against on-agent AI sessions), and **explainability/audit**.

Out of scope (delegated): the per-OS implementations of filesystem isolation beyond macOS (S2/S3, behind the new ServerPlatform capability); the client UI for editing policy and reviewing conflicts (Core/Desktop); enterprise RBAC role definitions (an enterprise-phase spec) — this spec defines how layered policy composes, not the role model that authors org layers.

## Non-goals

No arbitrary code in policy. The language is declarative and statically analyzable; it cannot execute. Programmatic/WASM policy plugins are explicitly deferred as a future escape hatch, not the base model. The engine also does not attempt syscall-level interception beyond what the filesystem-isolation capability provides.

---

## Pillar 1 — Rule language

Projection rules extend today's `patchwire.yml` (which already has `sync.exclude` globs and a `secretScan` gate). A rule is **`selector → action`**, where selectors are a fixed, non-Turing-complete set and actions live on two independent axes.

### Selectors (constrained set)

- **path** — glob over the workspace path (`src/**`, `**/*.env`, `infra/secrets/*`).
- **file-type** — coarse content class (`text`, `binary`, `generated`, `secret-like`); `secret-like` may be informed by the existing gitleaks integration.
- **identity** — who the projection is *for*: `agent:claude`, `provider:gemini`, `user:<id>`, `type:workspace|user|service`. This is how per-AI and per-user visibility is expressed.

Selectors combine by AND within a rule; multiple rules compose per the composition model (Pillar 2).

### Actions on two axes (revision: visibility vs. representation compose separately)

Visibility and representation are **orthogonal axes**, not one list. An effective action is a pair `(visibility, representation)`.

- **Visibility axis** — *how much is revealed*. A lattice, most-restrictive-wins:
  `allow` (full) ⊐ `redact` (structure visible, values masked) ⊐ `hide` (absent).
- **Representation axis** — *how a visible thing is materialized*. Composed separately:
  `identity` (as-is) · `transform` (alternate representation, e.g. compressed/optimized generated assets) · `virtualize` (synthetic/placeholder stand-in).

Examples mapped to the parent doc's cases:

| Path | Visibility | Representation |
|---|---|---|
| `.env` | `hide` | — |
| AWS credentials | `redact` | `identity` |
| generated assets | `allow` | `transform` |
| large vendored tree | `allow` | `virtualize` |

### Example `patchwire.yml` projection block

```yaml
projection:
  rules:
    - path: "**/*.env";          visibility: hide
    - path: "infra/secrets/**";  visibility: redact
    - path: "src/**";            visibility: allow      # to agent:claude
      for: [agent:claude]
    - path: "src/**";            visibility: hide        # doc agent sees no source
      for: [agent:docbot]
    - path: "build/generated/**"; visibility: allow; representation: transform
```

---

## Pillar 2 — Policy Composition Model

Layers stack **org → workspace → user → AI-provider → session**. They compose by these rules (locked, stated precisely):

1. The **Organization layer defines the maximum visibility envelope.**
2. **Lower layers may only narrow visibility** — never widen it.
3. **Effective visibility is computed using a most-restrictive-wins lattice** (`hide` ⊐ `redact` ⊐ `allow`).
4. **Representation actions (`transform` / `virtualize`) compose separately** from visibility actions — they describe how an already-visible item is shown and do not interact with the visibility lattice.
5. **Exceptions may only be granted by the Organization layer** and are compiled into the effective policy. No lower layer can author an exception that widens visibility; the org can carve an explicit, scoped exception that the compiler applies.
6. **Every effective projection must be explainable back to its originating rules** — each decision carries provenance (which rule, at which layer, produced it).

This is the deny-overrides model the governance positioning requires: a session can never grant itself more than the org allows, while the org retains the one authority to grant scoped exceptions. The two-axis split keeps "what you can see" (a hard security boundary) cleanly separated from "how it's rendered" (a presentation choice).

---

## Pillar 3 — Compilation & versioning

Because the agent is the source of truth and an enforcement point, **the agent compiles policy.** Layered rules resolve into a concrete **effective projection** for a specific consumer:

1. Gather the layer stack for the target `(workspaceId, identity, session, provider)`.
2. Resolve the visibility lattice per path; apply org exceptions; compose representation separately.
3. Produce an **effective projection**: a deterministic map of path → `(visibility, representation)` plus a **provenance index** (path → originating rule/layer) for explainability.
4. Compute **`projectionVersion`** as a content hash of the effective projection. This is exactly the version the Core spec tracks and the value `session.create` binds.
5. Push to subscribed clients via `projection.updated { version }`; bind to a session at `session.create.policyRef` (which resolves to a compiled `projectionVersion`).

The **`stale-projection` contract** (defined in Core) is enforced here: a command carrying an older `projectionVersion` than the agent's current effective projection is rejected; Core refreshes and replays. Acting on a stale projection could expose a now-hidden path or write to a now-redacted one, so this is a security gate, not just cache hygiene.

---

## Pillar 4 — Projection Security Model

Defining *what* a session may see is only half the job; the engine must *enforce* it against an AI session that runs **on the agent, where the real files physically exist**. The model (locked, stated precisely):

1. **Projection defines what the session may see.**
2. **Filesystem isolation enforces that projection at the OS level** whenever the platform supports it.
3. **Runtime/build execution occurs in a separately authorized context** that may access real secrets.
4. **AI sessions receive build results and artifacts, not direct access to the secret-bearing workspace.**
5. **Filesystem isolation is a first-class `ServerPlatform` capability, parallel to egress.**
6. **Platforms without filesystem isolation must surface an explicit degraded-security warning.**

Concretely: each AI session's worktree is materialized with its effective projection applied (hidden files absent, redacted files masked, transformed/virtualized files rendered). The AI process runs under a **filesystem-scoped sandbox** that exposes only that projected worktree and denies the real workspace path — implemented with the same OS mechanisms as egress (seatbelt on macOS; namespaces + bind-mounts on Linux). Builds and runtime that legitimately need the real secrets execute in a **separate authorized context** against the real workspace, and the session receives their **artifacts and results**, never a path into the secret-bearing tree.

This adds a capability to `ServerPlatform` (parallel to `egress`):

```ts
filesystemIsolation: CapabilityDescriptor; // type: 'seatbelt'|'namespaces'|'none'; requiresElevation?
```

Where `filesystemIsolation.type === 'none'`, the agent **must surface an explicit degraded-security warning** and the projection's redaction-from-AI guarantee is downgraded to projection-at-materialization only (the worktree is projected, but no OS-level barrier prevents path traversal). This mirrors the egress portability stance: fail loud, never silently weaken.

---

## Enforcement points (defense in depth)

| Boundary | Enforced by | Guarantee |
|---|---|---|
| AI session on the agent | filesystem-isolation sandbox (this spec) | AI cannot read real hidden/redacted files; build runs in a separate authorized context |
| Human's local view | agent materializes redacted bytes; Core renders read-only | the real secret never leaves the agent for the laptop |
| Client write-back | Core excludes projected paths from write-back (Core spec) | a redacted/virtualized local copy never overwrites the real remote |
| Stale visibility | `projectionVersion` gate (Pillar 3) | no operation runs against an out-of-date projection |

No single layer is trusted alone; visibility is enforced server-side at the OS level, client-side at materialization and write-back, and temporally via versioning.

---

## Explainability & audit

Provenance (Pillar 2.6 / Pillar 3.3) makes every effective projection **explainable**: for any path and consumer, the engine can answer "why is this hidden/redacted/transformed?" by naming the originating rule and layer. Compilation emits an explainability report; policy decisions and projection changes are written to the existing `audit-log.ts` and mirrored as `audit.recorded` / `projection.updated` events. This is the compliance surface that makes the governance positioning real: an org can prove what each AI agent could and could not see, and why.

Cost-governance rules (budget limits per the parent's future-governance note) can live in the same layered policy and compile alongside the projection; their enforcement point is `budget.exceeded` (Agent spec). This spec reserves the layering for them without defining their semantics yet.

---

## Cross-spec impacts

- **Agent & Protocol spec:** add `filesystemIsolation` to `ServerPlatform.capabilities` (parallel to `egress`); `session.create.policyRef` resolves to a compiled `projectionVersion`; provisioning detection probes the filesystem-isolation capability and the `consent` step surfaces its degraded-security warning when absent.
- **Core spec:** already aligned — consumes the compiled, versioned projection, enforces read-only/no-write-back, honors `stale-projection`. No change needed.

## Strangler reuse map

| Existing | v2 role |
|---|---|
| `patchwire.yml` `sync.exclude` globs | the primitive `hide` projection; migrates into `projection.rules` |
| `lib/secret-scan.ts` (gitleaks `--redact`) | assists the `secret-like` file-type selector and redaction detection |
| `.gitignore`-honoring sync | remains; projection layers on top of it |

## Mapping to migration phases

This is **S4** in the parent roadmap. The macOS filesystem-isolation implementation (seatbelt) ships first, reusing the egress sandbox infrastructure; Linux (namespaces) and Windows follow with their S2/S3 capability work. The rule language, composition model, compilation, and versioning are OS-independent and land with the macOS enforcement.

## Open questions (tracked, not blocking)

- The exact transform/virtualize catalog (which representations are built-in vs. extensible) — start with `transform: compress` and `virtualize: stub`, expand by demand.
- How org exceptions are authored and signed (ties into the enterprise RBAC spec).
- Performance of compiling effective projections for many concurrent sessions (cache by `(layer-stack-hash, identity)`).
- The separate-authorized-build-context mechanism detail (process vs. container) — coordinate with the session/worktree model in the Agent spec.

## References

- Parent: `docs/patchwire-v2-product-architecture-strategy.md`
- Agent & Protocol: `docs/specs/2026-06-12-agent-protocol-spec.md`
- Core: `docs/specs/2026-06-12-core-spec.md`
- Current precursors: `patchwire.yml`, `packages/cli/src/lib/secret-scan.ts`, `packages/cli/src/lib/config.ts`
