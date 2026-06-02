# Patchwire — Logo Generation Brief

> Use this as the system prompt for any image-gen tool (Midjourney v6/v7,
> Flux, Ideogram, Recraft, GPT-4o image, DALL-E 3, etc.). Paste the
> **Prompt** block verbatim, then ship the variants listed in
> **Deliverables**.

## What Patchwire is (1 sentence)

A local-first developer tool: you push your project to a remote machine,
the AI CLI runs there with the whole repo, and a **reviewable unified
diff** comes back — nothing else crosses the wire.

The metaphor that runs through everything is **the patch** — a small,
intentional signal that travels between two machines.

## Brand language already in market

| | |
|---|---|
| Type system | Fraunces Variable (display serif), Geist (sans), Geist Mono (code). The logo wordmark should compose with Fraunces. |
| Palette | Paper `#F5F1E8`, Ink `#0E0E10`, Bone `#E8E2D0`, **Phosphor `#C9F564`**, Amber `#FF8C42` |
| Mood | Editorial × terminal. Quiet. Restraint. Anti-flashy. Apple-doc-page minimalism with a hint of CRT-phosphor warmth. |
| Adjacent brands for vibe (not copy) | Linear, Vercel, Arc Browser, Things 3, Plain, Raycast |
| Anti-references | OpenAI clover, anything purple/blue "AI gradient", glossy 3D startup mascots, cartoony robot heads |

## The existing mark (what to evolve, not throw away)

Two squares on a diagonal, connected by a dashed horizontal wire, with a
single phosphor-green dot pinned mid-wire:

- **Top-left square**: outlined only (the *local* machine — paper)
- **Bottom-right square**: solid filled (the *remote* machine — ink)
- **Dashed line between them**: the wire (HTTP / rsync transport)
- **Phosphor dot at the midpoint**: the patch — the diff in flight

This composition already carries the product story. The new logo should
**iterate on this idea**, not replace it. Refinements welcome:

- crisper geometry (perfect squares, mathematically-placed wire)
- consider rotating the line slightly (e.g. dipping from upper-left to
  lower-right squares) to emphasize directionality
- the phosphor dot can be a small `+` mark (a one-line diff add) for
  more semantic punch
- typographic lockup: mark + "Patchwire" set in Fraunces, optical size
  144, weight 500, letter-spacing -0.01em, with the wordmark to the
  right of the mark (10px gap, baseline-aligned)

## Prompt (paste into image-gen)

```
Minimalist developer-tool logo for "Patchwire" — a local-first AI dev
tool that returns code diffs from a remote machine.

Composition: two precise geometric squares connected by a thin dashed
horizontal line. Upper-left square: hairline outline only, no fill.
Lower-right square: solid fill. Mid-line between them: one small
phosphor-green dot or tiny "+" mark (the patch). Mathematical precision,
Swiss-grid alignment, no decorative flourishes.

Style: editorial minimalism in the spirit of Linear, Vercel, and Arc
Browser. Flat vector. Pure geometric shapes. Hairline strokes (~1.5px on
a 32px artboard). No bevels, no gradients, no glow, no 3D, no shadows.
Feels like a piece of industrial precision hardware, not a startup
mascot. Square 1:1 aspect ratio. Transparent background.

Palette — strict, only these colors:
- Ink: #0E0E10 (off-black, never pure black)
- Bone: #E8E2D0 (warm off-white)
- Phosphor: #C9F564 (lime-green, RESERVED for the patch dot only —
  never used elsewhere in the mark)

Render TWO variants in a single image:
1. Light variant: ink mark on bone background
2. Dark variant: bone mark on ink background
The phosphor dot stays #C9F564 in BOTH variants — it is the brand anchor.

Negative constraints (absolutely avoid):
- no purple, blue, pink, or cyan gradients
- no thick rounded strokes
- no 3D depth, isometric perspective, or perspective tricks
- no robot, brain, neural-net, atom, or circuit imagery
- no concentric circles, no swooshes, no chevrons, no arrows
- no script fonts, no italics in the wordmark
- no "AI sparkle" four-pointed stars
- not glossy, not painterly, not playful
- not centered — the two squares must be diagonal (top-left + bottom-right)

Vibe references (do not copy): Linear's L, Vercel's triangle,
Plain's wordmark, the visual restraint of Apple's Human Interface
Guidelines documentation.

Output: 1024×1024 PNG, transparent background, two variants
side-by-side or stacked. SVG-friendly geometry (every shape should be
reducible to rectangle / line / circle primitives).
```

## Variations to also ask the generator to explore

If your tool supports multi-variant runs, ask for these alternates so we
can compare:

1. **Wire-led**: same dashed line, but the two squares are tiny —
   almost punctuation marks — and the wire spans most of the artboard.
   The phosphor dot is the visual centre of gravity.

2. **Diff-monogram**: a stylized `P` constructed from a `+` and `-`
   pair, like a unified diff. Phosphor `+`, ink `-`. No squares.

3. **Pinned waypoint**: just a single hairline horizontal line with
   the phosphor dot pinned on it. The most minimal possible mark.
   Pairs especially well with the Fraunces wordmark.

## Deliverables (what to ship back)

When you upload the assets, drop them in `packages/website/public/`
and `packages/website/src/assets/`:

| File | Purpose | Size |
|---|---|---|
| `logo.svg` | replaces `src/assets/logo.svg` — primary mark used by Starlight + landing topbar | viewBox `0 0 32 32`, vector |
| `logo-light.svg` | light-bg variant if you want a separate file | 32×32 |
| `logo-dark.svg` | dark-bg variant — most surfaces use dark | 32×32 |
| `og.png` | Open Graph + Twitter card image referenced from `<meta>` | 1200×630, mark + wordmark + tagline on ink |
| `favicon.svg` | overwrites `public/favicon.svg` | 32×32, single-color OK |
| `apple-touch-icon.png` | iOS home-screen | 180×180, ink bg with bone mark |

## Sizing test — the mark MUST hold at these sizes

| Surface | Size | Currently visible? |
|---|---|---|
| Favicon | 16×16 | Yes |
| Topbar wordmark | 22×22 | Yes (landing + Starlight + 404) |
| OG card mark | ~128×128 | Yes |
| Hero / brand-board | 400×400+ | Optional |

If the mark loses legibility at 16px (the favicon) — the dot vanishes,
the dashed wire collapses, the squares blur into a single blob — it has
failed. Test ruthlessly at 16px before considering the design done.

## Hard constraints summary

- Phosphor `#C9F564` is non-negotiable, and **reserved** to the patch dot
- The mark must work in both light and dark contexts
- Vector-friendly: every shape must be reducible to rect / line / circle
- No decoration outside the strict composition
- If you generate a wordmark lockup, the typeface must read as
  Fraunces (or be replaced with real Fraunces in the SVG handoff)

Once the assets are in `src/assets/` + `public/`, I'll:
1. Swap the SVG and verify the new mark holds at all sizes
2. Update `<meta property="og:image">` if the og.png path or aspect
   changes
3. Re-test view-transition morph (the `view-transition-name:
   brand-wordmark` should keep working with any visually-equivalent
   replacement)
4. Regenerate the favicon manifest if needed
