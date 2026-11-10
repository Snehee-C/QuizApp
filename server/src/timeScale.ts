// The deck-level relaxed-timing accommodation (DESIGN.md §6), and the single
// clamp that guards it.
//
// `timeScale` multiplies every countdown in a deck, so a host can lengthen the
// whole deck for players who need it rather than editing each slide. It had
// two independent spellings of the same bounds — the live session and the deck
// PATCH route — and a third path, deck export/import, that did not carry the
// field at all: a deck shared at x3 came back at x1, silently reverting the
// one accessibility accommodation a deck has.
//
// One module, so there is one answer to "what is a legal timeScale" and a new
// path that carries it cannot quietly invent a fourth.

export const MIN_TIME_SCALE = 1;
export const MAX_TIME_SCALE = 3;
export const DEFAULT_TIME_SCALE = 1;

/** A host can stretch every countdown, but not to the point of absurdity. */
export function clampTimeScale(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_TIME_SCALE;
  return Math.max(MIN_TIME_SCALE, Math.min(MAX_TIME_SCALE, n));
}
