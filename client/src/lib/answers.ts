// The answer slot system — see DESIGN.md §5.
//
// Every answer carries FOUR redundant channels so nothing depends on colour
// alone: hue, shape, letter, and a fixed screen position. The six fills sit on
// a monotonic lightness ladder solved against the sRGB gamut, so the set stays
// ordered and separable in greyscale, under deuteranopia/protanopia/tritanopia,
// and on a projector with a dying bulb.
//
// TWO SURFACES, TWO REQUIREMENTS -- this is why `bubbleHex` exists alongside
// `hex`. The answer board needs the slots separated from EACH OTHER, which is
// what the ladder solves. The lobby needs each slot separated from the CANVAS,
// because a bubble floats alone with no neighbour to imply its edge. Those are
// different problems and the ladder only solves the first: pushing E below A
// (see below) necessarily moved it toward a near-black canvas, and three slots
// measured 1.22:1 (E), 2.07:1 (A) and 2.96:1 (B) against it -- E read as a hole
// rather than a player. `bubbleHex` keeps the hue, since DESIGN.md §5 promises
// players arrive "in their avatar hue", and lifts lightness to the minimum
// that clears 3:1. Four slots already cleared it and are byte-identical.
//
// The ladder is monotonic at SIX options, not only at four: E extends below A
// and F above D (E < A < B < C < D < F). They were originally appended in the
// middle of the A-D ladder, which left adjacent pairs 1.07-1.16:1 apart in
// true greyscale -- a dead colour channel for anyone the other three channels
// are there to serve. See tokens.css for the solve.
//
// Colours live in CSS custom properties (tokens.css) so the Stage Light theme
// can override them without touching JS. The `hex` here is the Stage Dark value
// and exists only for <canvas> work (confetti, lobby bubbles), which cannot
// read custom properties.

export type AnswerShape = "triangle" | "diamond" | "circle" | "square" | "pentagon" | "hexagon";

export interface AnswerSlot {
  /** A–F, rendered on the tile as a redundant channel. */
  letter: string;
  shape: AnswerShape;
  /** CSS var references — these follow the active stage theme. */
  fill: string;
  deep: string;
  ink: string;
  /** Resolved Stage Dark hex, for canvas only. */
  hex: string;
  deepHex: string;
  /**
   * The fill for a slot drawn ALONE on the lobby canvas, rather than inside
   * the answer grid. Same hue, lifted far enough to clear 3:1 against the
   * lobby canvas. See the note below on why this is a separate value.
   */
  bubbleHex: string;
  /** Contrast of `ink` on `fill`, measured. Kept so the figure is auditable. */
  contrast: number;
}

export const ANSWER_SLOTS: AnswerSlot[] = [
  { letter: "A", shape: "triangle", fill: "var(--ans-a)", deep: "var(--ans-a-deep)", ink: "var(--ans-a-ink)", hex: "#091eda", deepHex: "#030c7e", bubbleHex: "#1542fe", contrast: 9.26 },
  { letter: "B", shape: "diamond",  fill: "var(--ans-b)", deep: "var(--ans-b-deep)", ink: "var(--ans-b-ink)", hex: "#b31b46", deepHex: "#720c2a", bubbleHex: "#bc0045", contrast: 6.47 },
  { letter: "C", shape: "circle",   fill: "var(--ans-c)", deep: "var(--ans-c-deep)", ink: "var(--ans-c-ink)", hex: "#2aada9", deepHex: "#1c7e7b", bubbleHex: "#2aada9", contrast: 6.97 },
  { letter: "D", shape: "square",   fill: "var(--ans-d)", deep: "var(--ans-d-deep)", ink: "var(--ans-d-ink)", hex: "#faa963", deepHex: "#cb7d34", bubbleHex: "#faa963", contrast: 9.95 },
  { letter: "E", shape: "pentagon", fill: "var(--ans-e)", deep: "var(--ans-e-deep)", ink: "var(--ans-e-ink)", hex: "#3e004b", deepHex: "#22002a", bubbleHex: "#a100bd", contrast: 15.67 },
  { letter: "F", shape: "hexagon",  fill: "var(--ans-f)", deep: "var(--ans-f-deep)", ink: "var(--ans-f-ink)", hex: "#b6e6ff", deepHex: "#8ab9d0", bubbleHex: "#b6e6ff", contrast: 14.36 },
];

export function slotFor(index: number): AnswerSlot {
  const n = ANSWER_SLOTS.length;
  return ANSWER_SLOTS[((index % n) + n) % n];
}

/** Stage Dark hexes, for canvas particles. */
export const ANSWER_HEXES = ANSWER_SLOTS.map((s) => s.hex);

// SVG path data for each shape, drawn inside a 24x24 box. Used on tiles, in
// the results distribution, and on the presenter stage so the same glyph marks
// the same option everywhere.
export const SHAPE_PATHS: Record<AnswerShape, string> = {
  triangle: "M12 3.5 21 20H3z",
  diamond: "M12 2.5 21.5 12 12 21.5 2.5 12z",
  circle: "M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 0 0 0-18.8z",
  square: "M4.2 4.2h15.6v15.6H4.2z",
  pentagon: "M12 2.5 21.5 9.4 17.9 20.6H6.1L2.5 9.4z",
  hexagon: "M12 2.3 20.4 7.1v9.8L12 21.7 3.6 16.9V7.1z",
};

export function ShapeGlyphPath(shape: AnswerShape): string {
  return SHAPE_PATHS[shape];
}
