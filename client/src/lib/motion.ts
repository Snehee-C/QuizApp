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

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
