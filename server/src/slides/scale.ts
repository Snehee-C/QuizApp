import type { SlideServerDef, RawResponse, ConfigIssue } from "./types.js";
import { broken, describe } from "./types.js";

export const scale: SlideServerDef = {
  type: "SCALE",
  interactive: true,

  validate(config, value) {
    const min = config?.scaleMin ?? 1;
    const max = config?.scaleMax ?? 5;
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  },

  // validate() accepts a value only when min <= value <= max, and aggregate()
  // builds its buckets with `for (i = min; i <= max; i++)`. An inverted or
  // collapsed range therefore means a slide with no buttons to tap and no
  // answer that can be accepted.
  validateConfig(config): ConfigIssue[] {
    const issues: ConfigIssue[] = [];
    const rawMin = config?.scaleMin;
    const rawMax = config?.scaleMax;
    const minOk = rawMin === undefined || Number.isInteger(rawMin);
    const maxOk = rawMax === undefined || Number.isInteger(rawMax);
    if (!minOk) issues.push(broken(`config.scaleMin must be a whole number, got ${describe(rawMin)}.`));
    if (!maxOk) issues.push(broken(`config.scaleMax must be a whole number, got ${describe(rawMax)}.`));
    if (minOk && maxOk) {
      const min = rawMin === undefined ? 1 : (rawMin as number);
      const max = rawMax === undefined ? 5 : (rawMax as number);
      if (max <= min) {
        issues.push(
          broken(
            `config.scaleMax (${max}) must be greater than config.scaleMin (${min}); as written the player is shown no steps to choose from and no answer can be accepted.`
          )
        );
      }
    }
    return issues;
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
