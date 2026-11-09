import type { SlideServerDef, RawResponse } from "./types.js";
import { speedPoints, stripAnswerKey } from "./types.js";

// Guess the number — players submit a number, the closest wins. Always
// quiz-scored: a "closest guess" round with no scoreboard has no point, so
// unlike multipleChoice there is no isQuiz toggle to turn off.
export const guessNumber: SlideServerDef = {
  type: "GUESS_NUMBER",
  interactive: true,

  // Both `correctValue` AND `tolerance` are the answer key here: a tolerance
  // of 5 tells the room the answer is a round-ish number and, combined with a
  // neighbour's guess, brackets it. stripAnswerKey already drops correctValue;
  // it is re-destructured rather than assumed so this module stays safe even
  // if that shared list is ever narrowed.
  sanitizeConfig(config) {
    if (!config || typeof config !== "object") return config;
    const { correctValue, tolerance, ...safe } = stripAnswerKey(config);
    return safe;
  },

  // NaN and Infinity are rejected here rather than in aggregate() because a
  // single Infinity would stretch the stage's number line into uselessness.
  validate: (_config, value) => typeof value === "number" && Number.isFinite(value),

  aggregate(config, responses: RawResponse[]) {
    const guesses: number[] = [];
    for (const r of responses) {
      const v = parse(r.value);
      if (typeof v === "number" && Number.isFinite(v)) guesses.push(v);
    }

    const sorted = [...guesses].sort((a, b) => a - b);
    const n = sorted.length;
    const median = n === 0 ? 0 : n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const average = n === 0 ? 0 : guesses.reduce((a, b) => a + b, 0) / n;

    // `closest` is derived from the answer key, and results:updated reaches
    // participants live — so it is a single already-public guess value and
    // never the target itself. The stage still withholds it until the reveal.
    const target = numberOrNull(config?.correctValue);
    let closest: number | null = null;
    if (target !== null) {
      for (const g of guesses) {
        if (closest === null || Math.abs(g - target) < Math.abs(closest - target)) closest = g;
      }
    }

    return { type: "GUESS_NUMBER", guesses, average, median, closest, total: responses.length };
  },

  grade(config, value, ctx) {
    if (!config?.isQuiz) return { correct: false, points: 0 };
    const target = numberOrNull(config.correctValue);
    if (target === null || typeof value !== "number" || !Number.isFinite(value)) {
      return { correct: false, points: 0 };
    }
    // tolerance 0 means exact match; anything outside the band scores nothing.
    // Proximity partial credit was considered and rejected — it makes the
    // leaderboard impossible to read against the other quiz types' 500–1000.
    const tolerance = Math.abs(numberOrNull(config.tolerance) ?? 0);
    if (Math.abs(value - target) > tolerance) return { correct: false, points: 0 };
    return { correct: true, points: speedPoints(config.timeLimitSec ?? 20, ctx) };
  },

  isTimed: (config) => !!config?.isQuiz,
  timeLimitSec: (config) => config?.timeLimitSec ?? 20,

  revealPayload: (config) => ({
    correctValue: numberOrNull(config?.correctValue) ?? 0,
    tolerance: Math.abs(numberOrNull(config?.tolerance) ?? 0),
  }),

  formatForExport(config, value) {
    const unit = typeof config?.unit === "string" ? config.unit.trim() : "";
    return unit ? `${value} ${unit}` : String(value);
  },
};

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
