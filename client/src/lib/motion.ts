// Motion tokens — see DESIGN.md §4.
//
// Springs for anything interruptible or touch-driven (press, reorder, sheets).
// Cubic-bezier for one-shot transitions (fade, colour, progress).
//
// Values are Material 3 Expressive's published set, split into "spatial"
// (moves/resizes, may overshoot) and "effects" (colour/opacity, never
// overshoots). Using a calibrated set beats inventing our own.

export const spring = {
  /** press, snap — ζ 0.6 */
  fast: { type: "spring" as const, stiffness: 800, damping: 34, mass: 1 },
  /** layout, reorder — ζ 0.8 */
  default: { type: "spring" as const, stiffness: 380, damping: 31, mass: 1 },
  /** sheets, scene changes — ζ 0.8 */
  slow: { type: "spring" as const, stiffness: 200, damping: 23, mass: 1 },
  /** colour/opacity — ζ 1.0, never overshoots */
  effect: { type: "spring" as const, stiffness: 1600, damping: 80, mass: 1 },
  /**
   * Visible overshoot — ζ ≈ 0.56. BUDGETED TO THREE MOMENTS ONLY:
   *
   *   1. the correct-answer stamp — the tile lift and its check, on the phone
   *      (AnswerTile), on the stage (StageAnswers), and in the slide types
   *      that draw their own answer (typeAnswer, guessNumber). One moment,
   *      rendered on several surfaces.
   *   2. the podium entrance (Podium)
   *   3. the "Answer" badge when the room is revealed (Present, via
   *      `animate-pop-in`, which is this curve as a CSS keyframe)
   *
   * Overshoot is punctuation; used everywhere it becomes a verbal tic. Count
   * the budget with `grep -rn "spring.pop\|animate-pop-in" src` — it is
   * stated in call sites deliberately, so the claim stays checkable.
   */
  pop: { type: "spring" as const, stiffness: 260, damping: 18, mass: 1 },
};

export const ease = {
  standard: [0.2, 0, 0, 1] as const,
  entrance: [0, 0, 0.2, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
  expoOut: [0.16, 1, 0.3, 1] as const,
  backOut: [0.34, 1.56, 0.64, 1] as const,
};

export const duration = {
  instant: 0.08,
  fast: 0.14,
  base: 0.22,
  slow: 0.32,
  stage: 0.52,
  reveal: 0.9,
};

/** Leaderboard rows. */
export const STAGGER = 0.035;
/** Distribution bars, podium cards. */
export const STAGGER_LG = 0.06;

/* ── The two peaks ───────────────────────────────────────────────────────
 *
 * Both of these are measured in MILLISECONDS, not seconds, because they are
 * beat structures rather than transition durations: they are read as a
 * score, and a score written in 0.9/1.15/0.3 is unreadable. Durations
 * derived from them divide by 1000 at the call site.
 *
 * The principle both share, and the thing that makes them peaks rather than
 * announcements: THE RESULT IS WITHHELD, and what the room already knows is
 * shown first. A held beat before a result is worth more than a faster
 * animation.
 */

/**
 * The standings race (DESIGN.md §5 moment 4; BarRaceLeaderboard).
 *
 *   0 ──────── arm ──────── │ ──────── run ──────── │ settle
 *   rows land in the        │ bars grow and people  │ +Δ chips,
 *   PREVIOUS order and      │ overtake; the order   │ rank moves,
 *   stay there              │ is DISCOVERED         │ the resolve
 *
 * `arm` is the whole mechanic. The board arrives in the order the room
 * remembers from last time, and holds there long enough for a person to find
 * their own name — which is what makes the overtake land on *them* rather
 * than on an anonymous bar. 900ms is the measured floor for that: the row
 * entrance (5 × STAGGER plus the spring's own settle) owns the first ~400ms,
 * so anything under ~800 leaves no still frame at all, and past ~1100 the
 * stage reads as stalled.
 *
 * `armCold` is for the first standings of a session, where there is no
 * remembered order and therefore nothing to withhold. Everyone races up from
 * zero instead, and the hold only has to cover the entrance.
 *
 * `run` is long on purpose. The reorder is not scheduled — rows are sorted by
 * their INTERPOLATED score every frame, so a row changes rank at the instant
 * its bar passes the one above it. That crossing is the whole event, and at
 * 1150ms with a decelerating curve it is legible from the back of a room.
 * Shorten this and the overtake becomes a cut.
 */
export const RACE = {
  arm: 900,
  armCold: 380,
  run: 1150,
};

/**
 * The answer reveal (DESIGN.md §5 moment 3; StageAnswers).
 *
 *   0 ─── close ─── │ ─── spread ─── │ ── hold ── │ answer
 *   the question    │ each tile      │ nothing    │ the correct tile
 *   shuts; the      │ morphs into    │ moves      │ lifts, haloes
 *   scrim drops     │ its own share  │            │ and stamps
 *
 * This INVERTS what the code did before. The old order gave the answer in
 * frame one (the correct tile lifted at t=70ms) and spent the remaining
 * second drawing a distribution nobody was still looking at. §5 lists the
 * morph last, and for a cross-fade-vs-morph argument that ordering is fine —
 * but as a piece of theatre it is backwards. What the room does not know yet
 * is both *what everyone picked* and *which was right*; spending the first
 * beat on the cheaper secret buys the expensive one a held silence.
 *
 * `hold` is 300ms of absolutely nothing — the shortest pause that still reads
 * as a pause on a projector rather than as a dropped frame. It is measured
 * from the LAST bar landing, not the first, which is why `answerAt` is a
 * function of the option count rather than a constant: the tiles spread
 * 60ms apart, so a fixed answer beat gives a four-option slide 300ms of
 * silence and a six-option slide 180ms. Measured on the fixed version, the
 * fourth tile was still settling 120ms before the answer arrived — the hold
 * the comment above claims was only ever true for tile A.
 */
export const REVEAL = {
  close: 300,
  spread: 560,
  hold: 300,
  /** The ✓ lands after the lift has started, never with it. */
  stamp: 120,
  /** When the correct tile lifts, for a slide with `options` options. */
  answerAt(options: number) {
    return (
      REVEAL.close + REVEAL.spread + Math.max(0, options - 1) * STAGGER_LG * 1000 + REVEAL.hold
    );
  },
};

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
