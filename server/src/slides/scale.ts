import type { SlideServerDef, RawResponse } from "./types.js";

export const scale: SlideServerDef = {
  type: "SCALE",
  interactive: true,

  validate(config, value) {
    const min = config?.scaleMin ?? 1;
    const max = config?.scaleMax ?? 5;
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  },

  aggregate(config, responses: RawResponse[]) {
    const min = config?.scaleMin ?? 1;
    const max = config?.scaleMax ?? 5;
    const distribution: Record<number, number> = {};
    for (let i = min; i <= max; i++) distribution[i] = 0;
    let sum = 0;
    let n = 0;
    for (const r of responses) {
      const v = parse(r.value);
      if (typeof v === "number" && v >= min && v <= max) {
        distribution[v]++;
        sum += v;
        n++;
      }
    }
    return {
      type: "SCALE",
      min,
      max,
      distribution,
      average: n ? sum / n : 0,
      total: responses.length,
    };
  },
};

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
