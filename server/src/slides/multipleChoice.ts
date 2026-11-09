import type { SlideServerDef, RawResponse } from "./types.js";
import { speedPoints } from "./types.js";

// Multiple choice. Doubles as "Quiz: select answer" when config.isQuiz is set,
// which is how Mentimeter models it too.
export const multipleChoice: SlideServerDef = {
  type: "MULTIPLE_CHOICE",
  interactive: true,

  validate(config, value) {
    const n = (config?.options ?? []).length;
    const picks = Array.isArray(value) ? value : [value];
    if (picks.length === 0) return false;
    if (!config?.allowMultiple && picks.length > 1) return false;
    return picks.every((p) => typeof p === "number" && Number.isInteger(p) && p >= 0 && p < n);
  },

  aggregate(config, responses: RawResponse[]) {
    const options: string[] = config?.options ?? [];
    const counts = new Array(options.length).fill(0);
    for (const r of responses) {
      const v = parse(r.value);
      for (const p of Array.isArray(v) ? v : [v]) {
        if (typeof p === "number" && p >= 0 && p < counts.length) counts[p]++;
      }
    }
    return { type: "MULTIPLE_CHOICE", options, counts, total: responses.length };
  },

  grade(config, value, ctx) {
    if (!config?.isQuiz) return { correct: false, points: 0 };
    const key: number[] = Array.isArray(config.correctIndices)
      ? config.correctIndices
      : typeof config.correctIndex === "number"
        ? [config.correctIndex]
        : [];
    if (key.length === 0) return { correct: false, points: 0 };

    const picks = (Array.isArray(value) ? value : [value]).filter(
      (p): p is number => typeof p === "number"
    );
    // With several correct options the player must select exactly the key —
    // partial credit would let someone pick everything and always score.
    const correct =
      key.length === 1
        ? picks.length === 1 && key.includes(picks[0])
        : picks.length === key.length && key.every((k) => picks.includes(k));

    if (!correct) return { correct: false, points: 0 };
    return { correct: true, points: speedPoints(config.timeLimitSec ?? 20, ctx) };
  },

  isTimed: (config) => !!config?.isQuiz,
  timeLimitSec: (config) => config?.timeLimitSec ?? 20,

  revealPayload: (config) => ({
    correctIndices:
      config?.correctIndices ??
      (typeof config?.correctIndex === "number" ? [config.correctIndex] : []),
  }),

  formatForExport(config, value) {
    const options: string[] = config?.options ?? [];
    const picks = Array.isArray(value) ? value : [value];
    return picks.map((p) => options[p as number] ?? String(p)).join("; ");
  },
};

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
