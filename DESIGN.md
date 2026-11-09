# FLOODLIGHT — Design System

The design language for this app.

The brief is Apple's: **pristine and perfect; nothing odd or out of place;
every part well-considered, consistent with every other part, and in harmony.**
This document is the standard that claim is measured against, and §3 is the
honest record of where we did not meet it.

---

## 1. The idea

> **The projector is a stage. The phone is a control deck.**
> **Neither of them is the subject. The room is.**

One bright, typographically enormous shared surface the whole room reads at a
glance, paired with a dense, quiet handheld surface. The interface itself
contributes nothing it does not have to.

Apple's three words — **clarity, deference, depth** — survive the move from a
handset to a lit room, but they are not free here. A quiz is a game show: its
whole point is the loud moment. Deference everywhere would be a failure, not a
success.

The resolution is the one Apple actually uses when it has a moment to sell
(a closing Fitness ring, Music Replay, an Arcade transition): **the spectacle
is earned by the silence around it, and it is made of light and motion rather
than ornament.** We spend nothing on decoration so we can spend everything on
four or five seconds. That is the whole system in a sentence.

---

## 2. The five principles

### P1 — One voice. Delete the synonyms.
Harmony is not a style you add; it is the **absence of two ways to say the same
thing.** One typeface. One type ladder. One spacing grid. One radius ladder. One
elevation model. One accent. One press behaviour.

Wherever two mechanisms did the same job, the weaker one is deleted rather than
documented. This is the principle the previous system failed hardest and most
measurably (§3), and it is the one that makes a product feel considered: a
reader cannot name it, but they can feel its absence everywhere.

**Test:** grep the codebase for a second spelling of any decision. If
`rounded-full` and `rounded-pill` both exist, the system has a dialect.

### P2 — Deference. The interface is a frame, never a subject.
Chrome is achromatic and recedes: surfaces, hairlines, and ink carry no hue of
their own beyond a faint shared tint. **Colour belongs to content** — the answer
slots, the avatars, the data — and to the accent, which is reserved for the
moment something happens.

Nothing on screen may exist that does not carry information. Texture, ornament,
and decorative gradients are not neutral; they are noise with a cost. The 2026
failure mode in this category is not ugliness, it is **busyness**.

**Test:** point at any pixel and name what it tells the viewer. If the answer is
"it makes it look nicer," it is deleted.

### P3 — Depth is light, not drawing.
There is one light source: above, slightly in front, never angled. Elevation is
expressed consistently through it, and only through it.

- A surface that sits higher in the stack is **lighter** (one step up the canvas
  ladder) and **casts further** (larger blur, lower opacity, never a larger
  offset than its blur).
- A **hairline separates**. A **shadow elevates**. They are different statements
  and are never used interchangeably or stacked to mean one thing.
- **No hard offset shadows.** A shadow with no blur is a drawing of a shadow.

**Test:** every shadow in the system must be derivable from the same light. A
`0 6px 0 0` lip cannot be, which is why it is gone.

### P4 — Geometry is concentric.
Nested corners share a centre: **`inner radius = outer radius − padding`.**
A 14px radius sitting inside a 14px radius with 12px of padding between them is
the most common source of "something is off here and I can't say what."

Radius scales with the element — a 32px chip and a 640px modal do not share a
corner. Corners are **continuous** (superellipse) where the browser supports it,
and degrade to a circular radius where it does not.

**Test:** for every nested pair, compute `outer − padding` and compare.

### P5 — Everything is on a ladder, and you choose by role.
Type, space, radius, elevation, and duration are each a finite, named ladder.
At the call site you choose a **role** (`body`, `footnote`, `title2`), never a
pixel value. A magic number in a component is a defect, not a shortcut: it is
how a system silently acquires twenty-one type sizes.

Two consequences that do most of the visible work:

- **Tracking rides the ladder.** Letter-spacing is baked into each type step and
  tightens as size grows (`−0.5%` at body, `−3.5%` at display). Optical
  compensation is the single clearest difference between text that looks typeset
  and text that looks defaulted.
- **Duration rides size.** Large things move slower. A sheet and a checkbox
  animating for the same 220ms is a tell.

**Test:** no arbitrary Tailwind value (`text-[15px]`, `gap-[13px]`) may appear in
a component. Enforced by `npm run lint:design`.

---

## 3. What changed, and why

The previous revision of this system was built around a Gen-Z/Duolingo
materiality thesis. Measured against the brief above, it had six defects. All
six are now fixed; they are recorded because a system that hides its own
corrections cannot be trusted about anything else.

| Was | Defect | Now |
|---|---|---|
| **3 typefaces** — Bricolage Grotesque (display), Geist (UI), Geist Mono | Three voices, and the second one was not doing its job. The *entire* functional case for Bricolage was its `wdth` axis ("condense before you shrink"), but `@fontsource-variable/bricolage-grotesque` resolves to a **weight-only build** (`*-wght-normal.woff2`); the width axis ships in a separate `wdth.css` that was never imported. So `font-variation-settings: "wdth" 75` in `FitText` had no axis to move, its binary search on width was a no-op, and every long question fell through to the shrink path — the exact behaviour the font was carried to avoid. QA measured it independently at `50.8px / font-stretch: 100%`. | **One family**, Geist, everywhere. `FitText` now balances the wrap and shrinks against a taller box — a mechanism that actually runs, and one that does not leave a condensed headline sitting above uncondensed answer tiles. Mono is retained for the **join code** and for literal strings you might type (a filename, a `host:port`); scores and timers use Geist's tabular figures. |
| **21 ad-hoc type sizes** — 10,11,12,13,14,15,16,17,18,19,20,22,24,26,28,30,32,34,40,42,44px across **251** call sites, with no scale | Sizes one pixel apart cannot be told apart but *can* be felt as disorder; and because they were arbitrary values, tracking and line-height were chosen independently at every site. This violates P1 and P5 simultaneously. | An **11-step ladder** with line-height and tracking baked into each step. |
| **The lip** — `0 6px 0 0` hard offset under every primary button and answer tile, 79 uses | Not derivable from any light source (P3), and a direct Duolingo/Kahoot quotation in a category where that reads as a costume. | Deleted. Press is `scale(0.97)` plus a brightness shift — the element responds where it is, which is what a real surface does. |
| **3% film grain** over every page | Decoration carrying no information (P2), and on a projector it is either invisible or dirt. | Deleted. |
| `rounded-full` and `rounded-pill`; bare `rounded` | Two spellings of one decision (P1). | `rounded-pill`, once. |
| "We have no drop-shadow system" asserted in the old §4, while `--elev-1..3` shipped three drop shadows | The document contradicted the tokens. A design system that is wrong about itself is worse than none. | One stated light model (P3); the tables below match the tokens, and `lint:design` fails if they drift. |

What was **kept**, because it was right and remains right: the two stage themes,
the solved answer-colour ladder, the four redundant channels, the 24px stage
floor and its automated audit, tabular numerals, and the measured contrast
contract. Those are in §5 and §6.

---

## 4. The ladders

Source of truth is `client/src/styles/tokens.css`; Tailwind maps onto it, so a
theme swap is one attribute on `<html>` and no class rewriting anywhere.

Colour is authored in **OKLCH** — perceptually uniform, so equal `L` means equal
visual weight across hues, and the second theme is arithmetic rather than a
second hand-tuned palette.

### Type — eleven steps
Named by role, after Apple's text styles, because a role survives a redesign and
a pixel value does not. Tracking and line-height are properties *of the step*.

| Role | Size | Leading | Tracking | Use |
|---|---|---|---|---|
| `caption2` | 11 | 1.35 | +0.01em | Timestamps, legal, axis ticks |
| `caption` | 12 | 1.35 | +0.005em | Metadata under a title |
| `footnote` | 13 | 1.4 | 0 | Secondary text, helper copy |
| `subhead` | 15 | 1.45 | −0.005em | Dense UI, table cells, labels |
| `callout` | 16 | 1.45 | −0.01em | Emphasised secondary |
| `body` | 17 | 1.5 | −0.011em | Default reading size |
| `title3` | 20 | 1.3 | −0.015em | Card titles |
| `title2` | 22 | 1.25 | −0.018em | Section headings |
| `title1` | 28 | 1.2 | −0.022em | Screen headings |
| `large-title` | 34 | 1.15 | −0.028em | Page titles |
| `display` | 40 | 1.1 | −0.032em | The one hero line on a screen |

**Weights:** 400 body, 500 emphasis, 600 headings and controls, 700 reserved for
the stage. Four weights, no more. Uppercase label text is the one place tracking
goes *positive* (`+0.06em`); without it, caps set tight read as a word jumble.

**Stage scale** is separate and viewport-anchored (`clamp()`, designed at
1920×1080) because the stage is read at 6 metres, not 60 centimetres. It is a
different problem, so it is a different ladder — not the UI ladder scaled up.

**Fitting (`FitText`).** A long question is binary-searched down from the top of
the stage ladder until it fits its box, with `text-wrap: balance` so the last
line is never an orphan and a line cap so it cannot become a paragraph. It
measures rather than guesses. A very long question is a **content** problem, not
a typographic one: the system sets it as large as the box honestly allows and
does not pretend a font axis is rescuing it.

### Space — 4px grid
`--s-0..13`: 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128. Everything
lands on it. The stage uses its own viewport units (`--stage-safe` 4.5vw,
`--stage-gap` 1.6vw) for the same reason the type does.

### Radius — scales with the element
`xs` 6 · `sm` 10 · `md` 14 · `lg` 20 · `xl` 28 · `2xl` 40 · `pill` 9999.
Applied **concentrically** (P4). Continuous corners via `corner-shape:
superellipse(4)` behind `@supports`, degrading to a circular radius.

### Elevation — one light
| Token | Meaning |
|---|---|
| `--line` (`--hairline` / `--hairline-str`) | **Separation.** 1px, no depth claim. `0 0 0 1px` renders crisper than `border` at fractional DPR and does not disturb layout. It is deliberately *not* called `elev-0` — that name was a hairline wearing an elevation label, and the rename is the whole of P1 in one token. |
| `--elev-1` | Resting on the canvas — card, tile |
| `--elev-2` | Lifted — popover, menu, the presenter control bar |
| `--elev-3` | Floating — modal, sheet |
| `--glow` | **Not elevation.** The accent's halo; §5 moments only. |
| `--focus` | 3px accent @45%, 2px offset. Never removed, only restyled. |

Each step's blur grows faster than its offset, and opacity falls as blur grows —
the behaviour of one soft light, further away.

### Motion — physics, not punctuation
Springs for anything interruptible or touch-driven (press, reorder, sheets);
cubic-bezier for one-shot transitions (fade, colour, progress). Durations scale
with the size of the thing moving: `instant` 80ms (press) → `fast` 140ms (hover,
chip) → `base` 220ms (control) → `slow` 320ms (panel) → `stage` 520ms (the room).

Overshoot (`spring.pop`) is budgeted to **exactly three moments**: the
correct-answer stamp, the podium entrance, and the "Answer" badge at reveal.
Overshoot is punctuation; applied everywhere it becomes a verbal tic.

The stamp is one moment rendered on several surfaces (the phone tile, the
stage tile, and the slide types that draw their own answer), so the budget is
counted in moments, not call sites. Springs are always referenced by name —
`spring.pop`, never `{ stiffness: 260, damping: 18 }` — so that
`grep -rn "spring.pop\|animate-pop-in" src` actually audits the budget. Nine
inline spring literals were collapsed into the named set for exactly this
reason; before that, the budget was an assertion no one could check.

**Never ease a clock.** The timer ring is `linear`, because a clock that
accelerates is lying.

---

## 5. The room contract

These are not stylistic positions; they are consequences of projecting to an
audience, and they are why this system is not simply iOS in a browser.

**A projector cannot display black.** In a lit room its "black" is ambient light
reflected off the screen; a dark stage measuring 17:1 on a monitor collapses to
roughly 4:1 on a 2,500-lumen projector with the lights up. Every competitor
ships dark-only and ignores this. So the presenter view ships **two themes** —
`Stage Dark` and `Stage Light` — toggled from the lobby in one tap and persisted
per host. On paper the accent cannot be acid lime, so Stage Light carries a deep
moss at the same perceptual weight.

**Hard floors on the stage:** text never below **24px**; a **4.5vw safe area**
(projectors crop, and heads block the bottom ~8%); and a target of **≥7:1 /
APCA Lc ≥ 90** — double the ordinary target, to absorb projection loss.

**The answer slots are solved, not picked.** Monotonic lightness
`0.42 / 0.50 / 0.68 / 0.80`, maximum in-gamut chroma at each step, every fill
clearing ≥6.4:1 against its own ink. Two dark slots take white ink, two light
slots take near-black; the ladder deliberately **straddles** the dead zone
around L 0.50–0.68 where neither ink reaches AAA-large. Being monotonic in
lightness, the set survives greyscale, every form of CVD, and a dying bulb.

**Correct/incorrect is never red/green.** Correct = accent + ✓ + glow +
scale up. Incorrect = desaturate + dim + ✕ + scale down. This clears the
~8%-of-men red/green trap and is emotionally softer than punishing someone in
red.

### Signature moments
The five places the budget is spent.

1. **Lobby** — join code at ~210px, a permanent ≥220px QR in true black-on-white
   (contrast is a scanner requirement, not a style choice), players arriving as
   bubbles with mass, in their own avatar hue.
2. **Countdown** — a radial ring, `linear`, accent→rose across the final 25%,
   a per-second pulse in the last three.
3. **Reveal** — a 900ms choreography: tiles freeze → wrong tiles desaturate and
   shrink → the correct tile lifts with an accent halo → ✓ stamps → **each tile
   morphs in place into its own distribution bar.** Morphing beats cross-fading
   to a separate chart: the thing you were looking at *becomes* the thing you
   are looking at now.
4. **Leaderboard** — bar-race reorder, 35ms stagger, +Δ chips, top five on
   stage, a pinned "you" row on the phone.
5. **Podium** — no cartoon steps. The winner's avatar hue floods the screen,
   name in display type, score counting up, two confetti bursts 180ms apart.

---

## 6. Accessibility contract

Measured, not asserted. Redundant encoding is geometry here, not an overlay.

- **Stage content:** ≥24px and ≥7:1. One documented exception: answer-tile
  labels render at 50px/600 — large text — and the two mid-ladder slots land at
  **5.6–7.0:1**. That is a direct consequence of the lightness ladder in §5
  (slots B and C sit nearest the dead zone) and clears AAA-for-large-text
  (4.5:1) with margin. The other four slots measure 8.6–10:1.
- **Presenter chrome** (the floating control bar) is read at desk distance, not
  from the back of the room, so it is held to AA 4.5:1 rather than 7:1.
- **Player text:** ≥14px, ≥4.5:1 (measured: all passing). Touch targets ≥44px;
  answer tiles up to 22vh.
- **Four redundant channels** on every answer: hue + shape (▲◆●■) + letter
  (A–D) + fixed screen position.
- `prefers-reduced-motion`: kill confetti, overshoot, parallax, bubble physics.
  Keep 120ms opacity crossfades.
- `prefers-contrast: more`: hairlines step up one level.
- Every audio cue has a visual equivalent; many rooms run muted.
- Optional per-session **relaxed timing (×1.5)** — time pressure is a known
  barrier for dyslexic and ADHD players.

**Two audits run in CI, because both failures are invisible by nature:**

- The **24px floor** audit walks the whole deck at 1920×1080 and measures
  *computed* font sizes. A dropped custom size renders as ordinary body text,
  not as an obvious bug — and that is not hypothetical: `tailwind-merge` could
  not distinguish `text-stage-answer` from `text-ink` and silently discarded the
  size at **eight** call sites until `lib/cn.ts` was taught the custom font-size
  group. Every name on the §4 type ladder is registered in that group for the
  same reason.
- The **contrast** audit resolves every colour through a canvas — computed style
  serialises as `oklch()`, and an `rgb()` regex silently reads channel numbers
  as bytes — and accounts for absolutely positioned fills behind a label.

---

## 7. Explicitly rejected

| Rejected | Why |
|---|---|
| Hard offset "lip" under buttons (Duolingo) | Not derivable from any light source (P3), and a costume quotation in this category. |
| Film grain / noise overlays | Decoration carrying no information (P2); on a projector it is invisible or dirt. |
| Violet→cyan aurora gradients | The most replicated gradient in 2026 branding; Kahoot, Quizizz and Mentimeter already own purple/blue. It now signals *generic*. |
| Gradients on buttons, text, or borders | A gradient is a room, not a decoration. Canvas layer only. |
| Glassmorphism as a page treatment | `backdrop-filter` costs 15–30% FPS on real devices and refraction destroys legibility in dense UI. Budget: **one** auto-hiding presenter control bar. |
| Pure `#000` / pure `#FFF` | Halation with saturated text on black; stark cold white. Warm-tinted near-black and warm paper instead. |
| A second typeface "for display" | We shipped one and never used the single feature that justified it (§3). One family, many optical sizes, is also what Apple actually does. |
| Arbitrary values in components | How a system acquires 21 type sizes (§3). Lint-enforced. |
| Emoji as interface icons | Reads as 2021. Emoji as *player avatars* is fine — that is content. |
| Cartoon 1-2-3 podium blocks | 2015 clip art, and it spends the biggest emotional moment of the product on a small graphic. |
| Mirroring question text on the phone | Splits attention away from the shared screen. The phone is a controller. Available as an explicit a11y toggle. |
| Red/green correct-wrong | See §5. |
| Thin progress-bar timer | Unreadable at distance, and no tension. Radial ring instead. |
