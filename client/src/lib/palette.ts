// Avatar/bubble colour helpers.
//
// The answer-slot system now lives in answers.ts (DESIGN.md §5). This file
// keeps only what the canvas-based surfaces need: lobby bubbles, leaderboard
// bars and podium spheres, all of which draw with resolved hex rather than CSS
// custom properties.

import { ANSWER_SLOTS, slotFor } from "./answers";

export { slotFor };

/** Stage Dark hexes, indexed like the answer slots. */
export const TILE_COLORS = ANSWER_SLOTS.map((s) => ({
  solid: s.hex,
  deep: s.deepHex,
  /**
   * The fill to use when the slot is drawn ALONE on the canvas (a lobby
   * bubble) rather than inside the answer grid. Same hue; lifted where the
   * ladder's own lightness would have left it too close to the canvas to read
   * as a disc. Identical to `solid` for the four slots that already cleared.
   */
  bubble: s.bubbleHex,
  shape: s.shape,
  letter: s.letter,
  /** Text colour that clears contrast ON this fill. The ladder straddles a
   *  dead zone, so the set splits between white and near-black ink: at six
   *  slots that is three and three (A, B, E white; C, D, F near-black), not
   *  the two-and-two the four-slot ladder had. */
  ink: s.ink,
}));

export function tileFor(index: number) {
  const n = TILE_COLORS.length;
  return TILE_COLORS[((index % n) + n) % n];
}

/** Lighten a #rrggbb by `amt` (0..255) per channel. */
export function lighten(hex: string, amt = 46): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + amt);
  const g = Math.min(255, ((n >> 8) & 255) + amt);
  const b = Math.min(255, (n & 255) + amt);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The lobby bubble fill: FLAT, in the player's own avatar hue.
 *
 * This was a sphere gradient with a specular highlight — a Frutiger-Aero
 * glass ball. Two problems: a gradient used as decoration rather than as a
 * canvas (DESIGN.md P2), and a second light source disagreeing with the one
 * the rest of the system casts from (P3). A flat tinted disc is also what the
 * hue is for: it identifies a person, and a gloss only makes that harder to
 * read at the back of the room.
 */
export function ballBg(solid: string): string {
  return solid;
}
