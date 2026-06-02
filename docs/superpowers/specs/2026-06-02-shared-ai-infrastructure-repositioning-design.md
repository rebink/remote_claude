# Patchwire repositioning — "Shared AI infrastructure for engineering teams"

**Date:** 2026-06-02
**Status:** Approved design, ready for implementation plan
**Scope of this cycle:** Website rewrite + positioning/strategy doc update. **No product/CLI/agent code.**

---

## 1. The decision

Patchwire repositions from a solo-dev framing ("Run AI remotely, review the diff") to:

> **Shared AI infrastructure for engineering teams.**

This was chosen over two alternatives that were explicitly rejected:

- **Full Flutter remote-dev platform** (compete with Codespaces / Coder / DevPod). Rejected: heavier build by years, and our own verified research (`docs/build-vs-buy-and-remote-flutter.md`) found the Flutter device loop **cannot be pooled** on a shared remote and iOS remote debugging is unsolved. Wrong problem, wrong size.
- **Leave positioning unchanged.** Rejected: the v0.2 site still leads with the solo-dev "only diffs cross the wire" claim, which is commoditized (Codex Cloud, Copilot agent, Cursor, Claude Code all ship remote+diff).

### Why this direction is defensible

The durable, rare combination — none of which is "remote development":

1. The agent runs on **infrastructure you control** (a box / VM / Mac mini), never a vendor cloud.
2. Developers **don't need AI credentials** — one subscription lives on the server.
3. The agent works on a **clean checkout** and **never touches the working tree**.
4. Every change returns as a **real Git diff**; nothing lands without a human.
5. A team **safely shares one expensive AI environment** — isolation, queue, and (roadmap) audit + cost visibility.

The buyer is the **engineering manager / platform / security lead** paying for many AI seats or unable to send code to vendor clouds — not the solo dev.

**Flutter is the proving ground / origin story, never the product identity.** The model is horizontal (any repo, any agent: Claude, Codex, Aider).

### Roadmap framing (recorded, not built this cycle)

- **High:** queue visibility, diff-review UX, multi-model, **usage/cost tracking**, audit history, policy enforcement.
- **Medium:** Android device bridge (adb-over-Tailscale), simulator forwarding, build-cache sharing.
- **Low / out of scope:** full remote Flutter dev, Codespaces replacement, remote IDE.

---

## 2. Hero

- **Eyebrow pill:** `0.2.x / 2026 · rev <n> · shipping` (keep existing).
- **H1:** Shared AI infrastructure for engineering teams.
- **Sub:** Run Claude, Codex, Aider — any coding agent — on machines you control. Every change comes back as a reviewable Git diff. Built for teams, not individual seats.
- **Tagline** (small, beside the terminal): *Only diffs cross the wire.* — demoted from headline to memorable sub-tagline.
- **Terminal demo:** keep the existing animated centerpiece unchanged (`rsync → queued (ahead: ana, ben) → accepted → spawn → diff → git apply`). It already tells the shared-queue story.
- **CTAs:** Get started (→ `/quickstart/`) · Read the docs.

---

## 3. Narrative spine (new section order)

Reuse the entire v0.2 design system (CSS tokens, kicker bars, animated terminal, VS Code mockup, reveal animations). This is a **re-spine + reword + two new sections**, not a redesign.

| # | Kicker | Section | Change |
|---|--------|---------|--------|
| — | — | Top bar | ✎ Nav = Docs · Quickstart · GitHub. **Remove "Pricing" link.** |
| — | — | Hero | ✎ New H1/sub/tagline (§2); terminal kept |
| 01 | the model | How it works | ▲ Moved up front; reframed as the 5-point model |
| 02 | for teams | Built for teams | ▲ Promoted near top; 3 pillars |
| 03 | governance | **Your manager finally has a view** | ＋ NEW flagship; `patchwire usage` panel |
| 04 | the stance | Control + governance | ✎ Reframed from "the big claim" |
| 05 | proving ground | Flutter origin story | ＋ NEW; keeps Dart demo + device-bridge teaser |
| 06 | surfaces | VS Code + CLI | ▲ Demoted from lead (was section 00) |
| 07 | setup | Two binaries + Tailscale | — Largely as-is |
| — | ↓ | End CTA | ✎ Team-framed |
| — | — | Footer | ✎ Team-framed tagline |

**Pricing (old section 06) is removed entirely** — the paid team layer isn't built; showing a price for it would be dishonest.

---

## 4. Per-section copy

### 01 · the model — H2: *One machine runs the AI. Your whole team shares it — safely.*
Five numbered points:
1. The agent runs on infrastructure **you** control — a box, VM, or Mac mini. Never a vendor cloud.
2. Developers don't need AI credentials. One subscription lives on the server.
3. The agent works on a **clean checkout** — it never touches your working tree.
4. Every change returns as a **real Git diff**. Nothing lands without a human.
5. The team shares one environment, with isolation and a queue.

### 02 · for teams — H2: *Built for teams, not individual seats.*
Three pillar cards:
- **Isolation** — each request runs in its own clean checkout; no one clobbers another's tree.
- **Queue** — requests line up on the shared box; you see your place in line.
- **One key, not fifteen** — your subscription lives on the server. Onboard a dev without provisioning AI access.

### 03 · governance — H2: *Your manager finally has a view.*
Lead: Run every request through one controlled box, and visibility comes for free.

Visual — `patchwire usage` panel, styled like the hero terminal, with a visible **`roadmap`** pill:
```
$ patchwire usage --month            ┌ roadmap ┐
DEVELOPER   REQUESTS   ACCEPTED   COST
ana            412        388    $61.40
ben            301        274    $44.80
rebin          189        160    $28.10
──────────────────────────────────────
total          902        822   $134.30   claude · june
```
Three supporting points, each tagged *[roadmap]*:
- **Cost visibility** — per-developer spend, one bill.
- **Audit trail** — who asked what, which diff landed.
- **Policy** — allowed models, repos, rate limits.

Honesty line under the panel: *The controlled-environment foundation ships today; usage, audit, and cost reporting are the near-term roadmap.*

### 04 · the stance — H2: *Your code only runs on infrastructure you control.*
The agent executes against your full repo — but on your box, never a vendor's cloud. Only diffs cross the wire back. For privacy- and IP-sensitive teams, that's the line between adopting AI and banning it.

### 05 · proving ground — H2: *It cut its teeth in a Flutter shop.*
Patchwire started solving a brutal version of this — a Flutter team sharing one powerful machine for AI and heavy builds, where hot laptops and per-dev tooling were daily friction. That's why the demo speaks Dart. The model isn't Flutter-specific — any repo, any agent — but mobile teams feel the pain first.

Device-bridge teaser (tagged *[roadmap]*): *Android device bridge (adb-over-Tailscale) — run on the shared box, hot-reload to the phone in your hand.*

### 06 · surfaces — H2: *Use it from the terminal or your editor.*
Two front ends, one config. A CLI for power users and CI; a native VS Code side panel with inline diff preview and one-keystroke apply. Swap any time. *(Reuse the existing VS Code mockup component.)*

### 07 · setup — H2: *Two binaries and Tailscale. That's the install.*
`patchwire` on each laptop, `patchwire-agent` on the shared box (launchd/systemd). Bearer-token HTTP over Tailscale or LAN. No platform to adopt, no containers to manage.

### End CTA — H2: *Give your team one AI environment.*
Sub: Self-host in an afternoon. Your code never leaves your network.
Buttons: Quickstart · GitHub.

---

## 5. Positioning / strategy doc update

Update `docs/project-brief.md`:
- **One line:** "Shared AI infrastructure for engineering teams — run any coding agent on hardware you control; every change returns as a reviewable Git diff."
- Reframe **Who it's for** to the eng-manager / platform / security buyer; note solo-dev is explicitly *not* the ICP.
- Add a short **Positioning** section capturing the 5-point model and the "Flutter = proving ground, not identity" rule, cross-referencing `docs/marketing-positioning-monetization.md` and `docs/build-vs-buy-and-remote-flutter.md`.
- Record the **roadmap tiers** (high/medium/low) from §1.

(Leave the two research docs intact — they remain the evidence base.)

---

## 6. Integrity rules (must hold across the site)

- Anything not shipped (usage/cost/audit/policy panels, device bridge, paid team tier) is **visibly tagged `roadmap`** and never implied as live.
- No invented metrics, logos, customer counts, or testimonials.
- "Only diffs cross the wire" stays accurate: it describes what crosses *back to the laptop*, not that code never moves (the repo still runs on the controlled box).

---

## 7. Out of scope (this cycle)

- Any CLI / agent / extension code (incl. actually building `patchwire usage`).
- New docs pages beyond the landing page.
- Visual redesign / new design system.
- Pricing/billing.

---

## 8. Success criteria

- Landing page leads with "Shared AI infrastructure for engineering teams"; the eng-manager buyer is addressed above the fold.
- New `01 model`, `02 for teams`, `03 governance` sections appear before the editor/CLI "surfaces" section.
- Governance section renders the `patchwire usage` panel with honest roadmap tagging.
- Flutter appears only as origin story + demo flavor — never as the product category.
- Pricing section and nav link are gone.
- `docs/project-brief.md` reflects the new one-liner, ICP, and roadmap tiers.
- Site builds cleanly (`pnpm --filter website build`) with no broken internal links.

---

## 9. Affected files

- `packages/website/src/pages/index.astro` — hero, section re-spine, copy, new sections, remove pricing.
- `packages/website/src/components/Footer.astro` — team-framed tagline; drop any pricing link.
- Top-bar nav (in `index.astro`) — remove "Pricing".
- `docs/project-brief.md` — positioning + ICP + roadmap update.
