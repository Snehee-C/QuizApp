import type { SlideServerDef, RawResponse } from "./types.js";

// Pin on image. One tap per participant, sent as { x, y } normalised to 0..1
// against the image's own box, so the server never needs to know — or trust —
// the pixel size anything was rendered at.
//
// Never scored: a pin has no answer key, so no grade() and no reveal payload.

interface Pt {
  x: number;
  y: number;
}

export const pinOnImage: SlideServerDef = {
  type: "PIN_ON_IMAGE",
  interactive: true,

  validate: (_config, value) => isUnitPoint(value),

  aggregate(_config, responses: RawResponse[]) {
    const points: Pt[] = [];
    for (const r of responses) {
      const v = parse(r.value);
      // Rows can predate a config change or come from an older client, and a
      // malformed one must not take down the presenter's whole stage.
      if (!isUnitPoint(v)) continue;
      points.push({ x: v.x, y: v.y });
    }
    return { type: "PIN_ON_IMAGE", points, total: points.length };
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
