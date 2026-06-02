# Shared AI Infrastructure Repositioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-spine and reword the Patchwire landing page (`packages/website/src/pages/index.astro`) to lead with "Shared AI infrastructure for engineering teams," add two new sections (governance + Flutter proving-ground), remove pricing, and update `docs/project-brief.md` to match.

**Architecture:** Pure content/markup re-spine of one Astro page. Reuse the entire v0.2 design system — no visual redesign. Two new sections reuse existing classes (`.teams`, `.termcard`, `.teampillar`, `.claim`); only three tiny CSS rules are added to `custom.css` (`.roadmap-pill`, `.hero-tagline`, `.endcta-sub`). No product/CLI/agent code.

**Tech Stack:** Astro (static), hand-written CSS in `packages/website/src/styles/custom.css`, pnpm workspace (`patchwire-docs`). No test framework — verification is `astro check && astro build`, `grep` structural assertions, and a dev-server visual pass.

**Source spec:** `docs/superpowers/specs/2026-06-02-shared-ai-infrastructure-repositioning-design.md`

### Reconciliation note (deviation from approved spine)
The approved spine listed 7 sections and did not mention the existing **features grid** ("05 · the gains"). To avoid deleting good shipped content, this plan **keeps that section, renumbered `07 · the gains`** with a deduped heading. Final numbered order is therefore 01–08, not 01–07. All other spine decisions are unchanged. Pricing is still removed entirely.

### Final target section order (top → bottom inside `<main>`)
```
HERO
01 · the model        (was "02 · the flow" — section.flow)
02 · for teams        (was "03 · for teams" — section.teams)
03 · governance       (NEW — reuses .teams/.termcard)
04 · the stance       (was "01 · the stance" — section.claim)
05 · proving ground   (NEW — reuses .claim)
06 · surfaces         (was "00 · from your editor" — section.editor)
07 · the gains        (was "05 · the gains" — section.feats, deduped)
08 · setup            (was "04 · setup" — section.setup)
END CTA
FOOTER
```

---

## Task 0: Branch + baseline build

**Files:** none (git + build only)

- [ ] **Step 1: Create a feature branch** (we are on `main`, the default branch)

```bash
cd /Users/apple/Documents/Workspace/patchwire
git checkout -b feat/reposition-shared-ai-infra
```

- [ ] **Step 2: Confirm the site builds green before any change**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0; ends with an Astro "Complete!" / build-finished line and no `astro check` errors.

If it fails on `main` before edits, STOP and report — the baseline is broken and must be fixed first.

---

## Task 1: Hero, `<head>` SEO, and top-bar nav

**Files:**
- Modify: `packages/website/src/pages/index.astro` (`<title>`/meta block lines ~16-41; top-bar nav lines ~54-61; hero H1/sub/CTA lines ~88-150)

- [ ] **Step 1: Update `<title>` and the description/OG/Twitter meta**

Replace the `<title>` line:
```html
    <title>Patchwire: only diffs cross the wire</title>
```
with:
```html
    <title>Patchwire — shared AI infrastructure for engineering teams</title>
```

Replace BOTH occurrences of this exact description string (it appears in `<meta name="description">` and `<meta property="og:description">`):
```
Run Claude, Codex, or Aider on a machine you control, not a coding-tool vendor's cloud. Every change comes back as a reviewable git diff before it touches your codebase.
```
with:
```
Run Claude, Codex, or Aider on machines you control. Every change comes back as a reviewable git diff. Shared, governed AI for your whole team — not individual seats.
```
(Use `replace_all` for that string.)

- [ ] **Step 2: Remove the Pricing link from the top nav**

Delete this exact line (index.astro ~line 57):
```html
        <a href="/#pricing">Pricing</a>
```

- [ ] **Step 3: Replace the hero H1**

Replace:
```html
        <h1 class="hero-h reveal">
          <span class="hero-h-line">Only diffs</span>
          <span class="hero-h-line">cross the</span>
          <span class="hero-h-line"><em>wire.</em></span>
        </h1>
```
with:
```html
        <h1 class="hero-h reveal">
          <span class="hero-h-line">Shared AI</span>
          <span class="hero-h-line">infrastructure for</span>
          <span class="hero-h-line"><em>engineering teams.</em></span>
        </h1>
```

- [ ] **Step 4: Replace the hero sub-paragraph and add the tagline**

Replace:
```html
        <p class="hero-sub reveal">
          Run Claude, Codex, or Aider on a machine <strong>you</strong> control
          &mdash; your box, not a coding-tool vendor's cloud. Every change comes
          back as a reviewable git diff before it touches your codebase.
        </p>
```
with:
```html
        <p class="hero-sub reveal">
          Run Claude, Codex, Aider &mdash; any coding agent &mdash; on machines
          <strong>you</strong> control. Every change comes back as a reviewable
          git diff. Built for teams, not individual seats.
        </p>
        <p class="hero-tagline reveal">Only diffs cross the wire.</p>
```

- [ ] **Step 5: Repoint the hero CTAs to Get started / Read the docs**

Replace the hero CTA block:
```html
        <div class="hero-cta reveal">
          <a href="/install-extension/" class="cta cta-primary magnet">
            <span class="cta-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M22 4.5l-9.5 7.5L22 19.5V4.5z" fill="currentColor"/>
                <path d="M3 8l5 5v6l9.5-7.5L8 4v6l-5-2z" fill="currentColor" opacity="0.85"/>
              </svg>
            </span>
            <span>Install for VS Code</span>
            <span class="cta-arrow">→</span>
          </a>
          <a href="/quickstart/" class="cta cta-ghost magnet">
            <span class="cta-icon" aria-hidden="true">$_</span>
            <span>Get the CLI</span>
            <span class="cta-arrow">→</span>
          </a>
        </div>
```
with:
```html
        <div class="hero-cta reveal">
          <a href="/quickstart/" class="cta cta-primary magnet">
            <span class="cta-icon" aria-hidden="true">$_</span>
            <span>Get started</span>
            <span class="cta-arrow">→</span>
          </a>
          <a href="/architecture/" class="cta cta-ghost magnet">
            <span>Read the docs</span>
            <span class="cta-arrow">→</span>
          </a>
        </div>
```

- [ ] **Step 6: Build to verify markup is valid**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0, no `astro check` errors. (`.hero-tagline` is unstyled until Task 8 — that is fine; it renders as plain text now.)

- [ ] **Step 7: Commit**

```bash
git add packages/website/src/pages/index.astro
git commit -m "feat(website): new hero + SEO meta, drop pricing nav link"
```

---

## Task 2: Reframe section labels in place (kickers, H2s, comment banners)

No sections move yet — this only relabels them so the reorder in Task 3 is unambiguous.

**Files:**
- Modify: `packages/website/src/pages/index.astro`

- [ ] **Step 1: Relabel the FLOW section → `01 · the model`**

Replace:
```html
    <!-- ───────── SECTION: HOW IT WORKS ───────── -->
    <section class="flow">
      <span class="kicker reveal"><span class="kicker-bar"></span>02 · the flow</span>
      <h2 class="flow-h reveal">
        One HTTP call. <em>End-to-end.</em>
      </h2>
```
with:
```html
    <!-- ───────── SECTION: THE MODEL ───────── -->
    <section class="flow">
      <span class="kicker reveal"><span class="kicker-bar"></span>01 · the model</span>
      <h2 class="flow-h reveal">
        One machine runs the AI. <em>Your whole team shares it.</em>
      </h2>
```

- [ ] **Step 2: Relabel the TEAMS section → `02 · for teams`**

Replace:
```html
      <span class="kicker reveal"><span class="kicker-bar"></span>03 · for teams</span>
```
with:
```html
      <span class="kicker reveal"><span class="kicker-bar"></span>02 · for teams</span>
```

- [ ] **Step 3: Relabel the CLAIM section → `04 · the stance`**

Replace:
```html
    <!-- ───────── SECTION: THE BIG CLAIM ───────── -->
    <section class="claim">
      <span class="kicker reveal"><span class="kicker-bar"></span>01 · the stance</span>
```
with:
```html
    <!-- ───────── SECTION: THE STANCE ───────── -->
    <section class="claim">
      <span class="kicker reveal"><span class="kicker-bar"></span>04 · the stance</span>
```

- [ ] **Step 4: Relabel the EDITOR section → `06 · surfaces`**

Replace:
```html
    <!-- ───────── SECTION: VS CODE EXTENSION ───────── -->
    <section class="editor">
      <div class="editor-grid">
        <div class="editor-prose">
          <span class="kicker reveal"><span class="kicker-bar"></span>00 · from your editor</span>
          <h2 class="editor-h reveal">
            Or, never <em>leave</em> your editor.
          </h2>
```
with:
```html
    <!-- ───────── SECTION: SURFACES (VS CODE + CLI) ───────── -->
    <section class="editor">
      <div class="editor-grid">
        <div class="editor-prose">
          <span class="kicker reveal"><span class="kicker-bar"></span>06 · surfaces</span>
          <h2 class="editor-h reveal">
            Use it from the terminal <em>or your editor.</em>
          </h2>
```

- [ ] **Step 5: Relabel the FEATS section → `07 · the gains` (deduped heading)**

Replace:
```html
      <span class="kicker reveal"><span class="kicker-bar"></span>05 · the gains</span>
      <h2 class="feats-h reveal">
        Built for the whole&nbsp;<em>team.</em>
      </h2>
```
with:
```html
      <span class="kicker reveal"><span class="kicker-bar"></span>07 · the gains</span>
      <h2 class="feats-h reveal">
        Everything in&nbsp;<em>the box.</em>
      </h2>
```

- [ ] **Step 6: Relabel the SETUP section → `08 · setup`**

Replace:
```html
      <span class="kicker reveal"><span class="kicker-bar"></span>04 · setup</span>
```
with:
```html
      <span class="kicker reveal"><span class="kicker-bar"></span>08 · setup</span>
```

- [ ] **Step 7: Build to verify**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/website/src/pages/index.astro
git commit -m "feat(website): relabel section kickers + headings for new spine"
```

---

## Task 3: Reorder existing sections

Move blocks so existing sections sit in this order inside `<main>`: HERO → flow → teams → claim → editor → feats → setup → endcta. (Pricing stays put for now; removed in Task 6. The two NEW sections are inserted in Tasks 4–5.)

**Files:**
- Modify: `packages/website/src/pages/index.astro`

- [ ] **Step 1: Read the current `<main>` to capture exact block boundaries**

Read `packages/website/src/pages/index.astro` lines 68–645. Each section is delimited by its `<!-- ───────── SECTION: … ───────── -->` banner and ends at the matching `</section>`. Note the start/end line of each: HERO, SURFACES (editor), THE STANCE (claim), THE MODEL (flow), BUILT FOR TEAMS (teams), SETUP, FEATURES (feats), PRICING, CTA (endcta).

- [ ] **Step 2: Move the MODEL (flow) and FOR TEAMS (teams) sections to directly after HERO**

Currently `editor` (SURFACES) sits first after the hero. Cut the entire `<!-- SECTION: THE MODEL -->…</section>` block and the entire `<!-- SECTION: BUILT FOR TEAMS -->…</section>` block from their current positions and paste them, in that order (MODEL then FOR TEAMS), immediately after the hero `</section>` (just before the `<!-- SECTION: SURFACES -->` banner).

- [ ] **Step 3: Move the SURFACES (editor) section to directly after THE STANCE (claim)**

Cut the entire `<!-- SECTION: SURFACES (VS CODE + CLI) -->…</section>` block and paste it immediately after the `<!-- SECTION: THE STANCE -->…</section>` block's closing `</section>`.

- [ ] **Step 4: Verify the resulting comment-banner order with grep**

Run:
```bash
grep -nE "SECTION: (THE MODEL|BUILT FOR TEAMS|THE STANCE|SURFACES|FEATURES|PRICING|CTA)" packages/website/src/pages/index.astro
```
Expected order, top to bottom: `THE MODEL` → `BUILT FOR TEAMS` → `THE STANCE` → `SURFACES` → `FEATURES` → `PRICING` → `CTA`.

- [ ] **Step 5: Verify kicker order with grep**

Run:
```bash
grep -oE "0[0-9] · [a-z ]+" packages/website/src/pages/index.astro
```
Expected (in order): `01 · the model`, `02 · for teams`, `04 · the stance`, `06 · surfaces`, `07 · the gains`, `08 · setup`. (03 and 05 are the NEW sections, added next; the gap is expected at this step.)

- [ ] **Step 6: Build to verify nothing broke during the move**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/website/src/pages/index.astro
git commit -m "feat(website): reorder sections for shared-infra narrative spine"
```

---

## Task 4: Add the governance section (`03 · governance`)

Insert after the `BUILT FOR TEAMS` section's closing `</section>` and before `THE STANCE`. Reuses `.teams`, `.termcard`, `.teampillar`, `.t-com/.t-ok/.t-str`.

**Files:**
- Modify: `packages/website/src/pages/index.astro`

- [ ] **Step 1: Insert the governance section**

Immediately after the `BUILT FOR TEAMS` `</section>` (and before `<!-- ───────── SECTION: THE STANCE ───────── -->`), insert:
```html

    <!-- ───────── SECTION: GOVERNANCE ───────── -->
    <section class="teams">
      <span class="kicker reveal"><span class="kicker-bar"></span>03 · governance</span>
      <h2 class="teams-h reveal">
        Your manager finally has a <em>view.</em>
      </h2>
      <p class="teams-sub reveal">
        Run every request through one controlled box and visibility comes for
        free &mdash; usage, cost, and a paper trail, without a dashboard to babysit.
      </p>

      <div class="teams-grid">
        <article class="termcard reveal" data-tilt>
          <header class="termcard-bar">
            <span class="term-dots"><span></span><span></span><span></span></span>
            <span class="termcard-host">$ patchwire usage --month</span>
            <span class="roadmap-pill">roadmap</span>
          </header>
          <pre class="termcard-body"><span class="t-com">DEVELOPER   REQUESTS   ACCEPTED      COST</span>
ana            412        388    <span class="t-ok">$61.40</span>
ben            301        274    <span class="t-ok">$44.80</span>
rebin          189        160    <span class="t-ok">$28.10</span>
<span class="t-com">─────────────────────────────────────────</span>
total          902        822   <span class="t-ok">$134.30</span>   <span class="t-str">claude · june</span></pre>
        </article>

        <div class="teams-prose">
          <article class="teampillar reveal">
            <span class="teampillar-no">01</span>
            <div>
              <h3>Cost visibility <span class="roadmap-pill">roadmap</span></h3>
              <p>Per-developer spend on a single bill, derived from the same turns the agent already records.</p>
            </div>
          </article>
          <article class="teampillar reveal">
            <span class="teampillar-no">02</span>
            <div>
              <h3>Audit trail <span class="roadmap-pill">roadmap</span></h3>
              <p>Who asked what, and which diff actually landed &mdash; building on today's JSONL log.</p>
            </div>
          </article>
          <article class="teampillar reveal">
            <span class="teampillar-no">03</span>
            <div>
              <h3>Policy <span class="roadmap-pill">roadmap</span></h3>
              <p>Allowed models, repos, and rate limits, enforced at the one box every request flows through.</p>
            </div>
          </article>
          <p class="teams-sub reveal">
            The controlled-environment foundation ships today; usage, audit, and
            cost reporting are the near-term roadmap.
          </p>
        </div>
      </div>
    </section>
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/website/src/pages/index.astro
git commit -m "feat(website): add governance section (patchwire usage, roadmap-tagged)"
```

---

## Task 5: Add the proving-ground section (`05 · proving ground`)

Insert after `THE STANCE` `</section>` and before `SURFACES`. Reuses `.claim`, `.claim-h`, `.claim-sub`.

**Files:**
- Modify: `packages/website/src/pages/index.astro`

- [ ] **Step 1: Insert the proving-ground section**

Immediately after the `THE STANCE` `</section>` (and before `<!-- ───────── SECTION: SURFACES (VS CODE + CLI) ───────── -->`), insert:
```html

    <!-- ───────── SECTION: PROVING GROUND ───────── -->
    <section class="claim">
      <span class="kicker reveal"><span class="kicker-bar"></span>05 · proving ground</span>
      <h2 class="claim-h reveal">
        It cut its teeth in a <em>Flutter</em> shop.
      </h2>
      <p class="claim-sub reveal">
        Patchwire started solving a brutal version of this &mdash; a Flutter team
        sharing one powerful machine for AI and heavy builds, where hot laptops and
        per-developer tooling were daily friction. That&rsquo;s why the demo speaks
        Dart. The model isn&rsquo;t Flutter-specific &mdash; any repo, any agent
        &mdash; but mobile teams feel the pain first.
      </p>
      <p class="claim-sub reveal">
        <span class="roadmap-pill">roadmap</span> Android device bridge
        (adb-over-Tailscale) &mdash; run on the shared box, hot-reload to the phone
        in your hand.
      </p>
    </section>
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0, no errors.

- [ ] **Step 3: Verify the full kicker order is now complete and sequential**

Run:
```bash
grep -oE "0[0-9] · [a-z ]+" packages/website/src/pages/index.astro
```
Expected, in order: `01 · the model`, `02 · for teams`, `03 · governance`, `04 · the stance`, `05 · proving ground`, `06 · surfaces`, `07 · the gains`, `08 · setup`.

- [ ] **Step 4: Commit**

```bash
git add packages/website/src/pages/index.astro
git commit -m "feat(website): add Flutter proving-ground section + device-bridge teaser"
```

---

## Task 6: Remove the pricing section

**Files:**
- Modify: `packages/website/src/pages/index.astro`

- [ ] **Step 1: Delete the entire pricing section**

Remove the whole block from the banner `<!-- ───────── SECTION: PRICING (open-core) ───────── -->` through its closing `</section>` (in the current file this is the `<section class="pricing" id="pricing">…</section>` block, including the trailing `<p class="price-foot reveal">…</p>` that sits inside it). Leave the surrounding `FEATURES` and `CTA` sections intact.

- [ ] **Step 2: Verify no pricing markup or anchors remain**

Run:
```bash
grep -niE "section class=\"pricing\"|id=\"pricing\"|#pricing|>Pricing<" packages/website/src/pages/index.astro
```
Expected: no matches. (Leftover `.pricing*` rules in CSS are harmless dead styles and are intentionally left untouched.)

- [ ] **Step 3: Build to verify**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/website/src/pages/index.astro
git commit -m "feat(website): remove pricing section (paid tier not shipped)"
```

---

## Task 7: End-CTA, footer & nav pricing cleanup

**Files:**
- Modify: `packages/website/src/pages/index.astro` (end-cta + inline footer)
- Modify (only if it contains a pricing link): `packages/website/src/components/Footer.astro`

- [ ] **Step 1: Reword the end-CTA**

Replace:
```html
    <!-- ───────── SECTION: CTA ───────── -->
    <section class="endcta">
      <div class="endcta-inner">
        <span class="kicker reveal">↓ apply</span>
        <h2 class="endcta-h reveal">
          Three&nbsp;minutes.<br/>
          One YAML.<br/>
          <em>Diffs forever.</em>
        </h2>
        <div class="endcta-actions reveal">
          <a href="/quickstart/" class="cta cta-primary magnet cta-lg">
            <span>Read the Quickstart</span>
            <span class="cta-arrow">→</span>
          </a>
          <a href="/install-extension/" class="cta cta-ghost magnet cta-lg">
            <span>Install the VS Code extension</span>
            <span class="cta-arrow">↗</span>
          </a>
        </div>
      </div>
    </section>
```
with:
```html
    <!-- ───────── SECTION: CTA ───────── -->
    <section class="endcta">
      <div class="endcta-inner">
        <span class="kicker reveal">↓ get started</span>
        <h2 class="endcta-h reveal">
          Give your team<br/>
          one AI <em>environment.</em>
        </h2>
        <p class="endcta-sub reveal">
          Self-host in an afternoon. Your code never leaves your network.
        </p>
        <div class="endcta-actions reveal">
          <a href="/quickstart/" class="cta cta-primary magnet cta-lg">
            <span>Read the Quickstart</span>
            <span class="cta-arrow">→</span>
          </a>
          <a href={repo} class="cta cta-ghost magnet cta-lg">
            <span>View on GitHub</span>
            <span class="cta-arrow">↗</span>
          </a>
        </div>
      </div>
    </section>
```

- [ ] **Step 2: Find and remove any pricing links in the footer(s)**

Run:
```bash
grep -niE "pricing|#pricing" packages/website/src/pages/index.astro packages/website/src/components/Footer.astro
```
For any match that is a footer link to pricing (e.g. `<a href="/#pricing">Pricing</a>`), delete that link. If there are no matches, no edit is needed — note that and continue.

- [ ] **Step 3: Build to verify**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/website/src/pages/index.astro packages/website/src/components/Footer.astro
git commit -m "feat(website): team-framed end CTA + remove footer pricing link"
```

---

## Task 8: Add the three small CSS rules

**Files:**
- Modify: `packages/website/src/styles/custom.css` (append)

- [ ] **Step 1: Append the new rules to the end of `custom.css`**

```css

/* ── Repositioning additions (2026-06) ───────────────────── */

/* "Only diffs cross the wire." tagline under the hero sub */
.hero-tagline {
  margin: 0.4rem 0 0;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 0.82rem;
  letter-spacing: 0.04em;
  color: #C9F564;
  opacity: 0.85;
}

/* "roadmap" pill — marks forward-looking, not-yet-shipped capabilities */
.roadmap-pill {
  display: inline-block;
  margin-left: 0.5em;
  padding: 0.1em 0.55em;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 0.62em;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #C9F564;
  background: rgba(201, 245, 100, 0.06);
  border: 1px solid rgba(201, 245, 100, 0.4);
  border-radius: 999px;
  vertical-align: middle;
}

/* sub-line under the end-CTA heading */
.endcta-sub {
  margin: 1rem auto 0;
  max-width: 40ch;
  font-size: 1.05rem;
  line-height: 1.5;
  opacity: 0.8;
}
```

- [ ] **Step 2: Build to verify the CSS compiles and is referenced**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/website/src/styles/custom.css
git commit -m "feat(website): styles for hero tagline, roadmap pill, end-CTA sub"
```

---

## Task 9: Update `docs/project-brief.md`

**Files:**
- Modify: `docs/project-brief.md`

- [ ] **Step 1: Read the current brief**

Read `docs/project-brief.md` in full to capture the exact text of the `## One line`, `## Who it's for`, and `## Status` sections before editing.

- [ ] **Step 2: Replace the one-liner**

Under `## One line`, replace the existing sentence with:
```
Shared AI infrastructure for engineering teams — run any coding agent (Claude, Codex, Aider) on hardware you control; every change returns as a reviewable Git diff, with isolation, a fair queue, and an audit trail across the whole team.
```

- [ ] **Step 3: Rewrite `## Who it's for`**

Replace the body of `## Who it's for` with:
```
The buyer is the **engineering manager / platform / security lead** at a team that
either pays for many AI coding seats or cannot send source code to a vendor's
cloud. The solo developer is explicitly **not** the ICP — they will use Cursor or
Claude Code directly. Patchwire wins where one controlled, shared environment plus
governance matters more than a per-seat IDE assistant.
```

- [ ] **Step 4: Add a `## Positioning` section**

Insert a new `## Positioning` section (immediately after `## One line`):
```
## Positioning

**Category:** shared AI infrastructure for software teams — *not* a remote-dev
platform (we do not compete with Codespaces / Coder / DevPod) and *not* a solo-dev
tool.

The defensible model (rare in combination):

1. The agent runs on infrastructure **you** control — never a vendor cloud.
2. Developers don't need AI credentials; one subscription lives on the server.
3. The agent works on a clean checkout and never touches the working tree.
4. Every change returns as a real Git diff; nothing lands without a human.
5. A team safely shares one expensive AI environment — isolation, queue, and
   (roadmap) audit + cost visibility.

**Flutter is the proving ground / origin story, never the product identity.** The
model is horizontal: any repo, any agent.

**Roadmap tiers:**
- *High:* queue visibility, diff-review UX, multi-model, usage/cost tracking,
  audit history, policy enforcement.
- *Medium:* Android device bridge (adb-over-Tailscale), simulator forwarding,
  build-cache sharing.
- *Low / out of scope:* full remote Flutter dev, Codespaces replacement, remote IDE.

See `docs/marketing-positioning-monetization.md` and
`docs/build-vs-buy-and-remote-flutter.md` for the evidence base.
```

- [ ] **Step 5: Commit**

```bash
git add docs/project-brief.md
git commit -m "docs: update project brief to shared-AI-infrastructure positioning"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Clean production build**

Run: `pnpm --filter patchwire-docs build`
Expected: exits 0; `astro check` reports 0 errors.

- [ ] **Step 2: Assert final section order**

Run:
```bash
grep -oE "0[0-9] · [a-z ]+" packages/website/src/pages/index.astro
```
Expected exactly, in order: `01 · the model`, `02 · for teams`, `03 · governance`, `04 · the stance`, `05 · proving ground`, `06 · surfaces`, `07 · the gains`, `08 · setup`.

- [ ] **Step 3: Assert pricing is gone and the new hero is present**

Run:
```bash
grep -niE "section class=\"pricing\"|id=\"pricing\"" packages/website/src/pages/index.astro   # expect: no matches
grep -n "Shared AI" packages/website/src/pages/index.astro                                     # expect: hero H1 match
grep -c "roadmap-pill" packages/website/src/pages/index.astro                                  # expect: 4 (1 panel header + 3 pillars + 1 teaser = 5; accept >=4)
```
(The proving-ground teaser adds one more `roadmap-pill`; treat any count ≥ 4 as pass.)

- [ ] **Step 4: Visual pass on the dev server**

Run `pnpm --filter patchwire-docs dev` (starts Astro on http://localhost:4321). Open the page and confirm, top to bottom:
- Hero reads "Shared AI infrastructure for engineering teams" with the green "Only diffs cross the wire." tagline below the sub.
- Sections appear in the order from Step 2.
- The governance section shows the `patchwire usage` panel with a visible green `roadmap` pill in its header, and `roadmap` pills on each of the three pillars.
- The proving-ground section shows the Flutter origin copy + the device-bridge `roadmap` teaser.
- No pricing section anywhere; nav has no Pricing link.
- End-CTA reads "Give your team one AI environment." with the sub-line and a "View on GitHub" button.

Stop the dev server when done (Ctrl-C).

- [ ] **Step 5: Confirm clean tree**

Run: `git status`
Expected: working tree clean (all changes committed across Tasks 1–9).

---

## Self-review (completed by plan author)

- **Spec coverage:** hero §2 → Task 1; spine/order §3 → Tasks 2–3; per-section copy §4 → Tasks 2 (relabels), 4 (governance), 5 (proving ground); pricing removal → Task 6; end-CTA/footer → Task 7; new CSS → Task 8; project-brief §5 → Task 9; integrity/roadmap tagging §6 → roadmap pills in Tasks 4–5 + custom rule in Task 8; success criteria §8 → Task 10. The features-grid gap (in spec but kept) is documented in the Reconciliation note and handled in Task 2 Step 5.
- **Placeholder scan:** none — every edit step carries exact old/new strings or full markup; verification steps carry exact commands + expected output.
- **Type/name consistency:** class names (`.teams`, `.termcard`, `.teampillar`, `.claim`, `.roadmap-pill`, `.hero-tagline`, `.endcta-sub`), kicker strings, and the build command `pnpm --filter patchwire-docs build` are used identically across all tasks. Kicker numbering 01–08 is sequential and matches the target-order table.
