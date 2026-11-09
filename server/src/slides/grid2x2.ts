import type { SlideServerDef, RawResponse } from "./types.js";

// 2x2 grid / matrix. One dot per participant on a two-axis plane, sent as
// { x, y } with both axes normalised to 0..1 and y running BOTTOM->TOP.
//
// Never scored: there is no right answer to "how important is this", so the
// module deliberately defines no grade() and no reveal payload.

interface Pt {
  x: number;
  y: number;
}

/** Quadrant order, fixed so the client can index it: BL, BR, TL, TR. */
const BOTTOM_LEFT = 0;
const BOTTOM_RIGHT = 1;
const TOP_LEFT = 2;
const TOP_RIGHT = 3;

export const grid2x2: SlideServerDef = {
  type: "GRID_2X2",
  interactive: true,

  validate: (_config, value) => isUnitPoint(value),

  aggregate(_config, responses: RawResponse[]) {
    const points: Pt[] = [];
    const quadrants = [0, 0, 0, 0];
    let sumX = 0;
    let sumY = 0;

    for (const r of responses) {
      const v = parse(r.value);
      // Rows written before a config change, or by an older client, can still
      // be malformed — aggregate must never throw on the presenter's behalf.
      if (!isUnitPoint(v)) continue;
      points.push({ x: v.x, y: v.y });
      sumX += v.x;
      sumY += v.y;
      // The midlines belong to the top/right halves, so every point lands in
      // exactly one bucket and the four counts always sum to points.length.
      const right = v.x >= 0.5;
      const top = v.y >= 0.5;
      quadrants[top ? (right ? TOP_RIGHT : TOP_LEFT) : right ? BOTTOM_RIGHT : BOTTOM_LEFT]++;
    }

    const centroid =
      points.length > 0 ? { x: sumX / points.length, y: sumY / points.length } : null;

    return { type: "GRID_2X2", points, centroid, quadrants, total: points.length };
  },

  formatForExport(_config, value) {
    if (!isUnitPoint(value)) return "";
    return `${value.x.toFixed(3)}, ${value.y.toFixed(3)}`;
  },
};

function isUnitPoint(value: unknown): value is Pt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { x, y } = value as Record<string, unknown>;
  return isUnitNumber(x) && isUnitNumber(y);
}

function isUnitNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
