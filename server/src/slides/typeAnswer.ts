import type { SlideServerDef, RawResponse } from "./types.js";
import { speedPoints, stripAnswerKey } from "./types.js";

const MAX_LEN = 120;

/**
 * The comparison form of an answer. Trimmed, with internal whitespace runs
 * collapsed, so "new  york" and "New York " are the same answer — people type
 * on phone keyboards, and losing a point to a double space is a bug, not a
 * quiz. Case folding is opt-out so that case-sensitive rounds (chemical
 * symbols, acronyms) are still possible.
 */
function normalize(s: string, caseSensitive: boolean): string {
  const collapsed = s.trim().replace(/\s+/g, " ");
  return caseSensitive ? collapsed : collapsed.toLocaleLowerCase();
}

// Quiz: type answer — free text graded against a list of accepted spellings.
export const typeAnswer: SlideServerDef = {
  type: "TYPE_ANSWER",
  interactive: true,

  // `acceptedAnswers` is the entire answer key. stripAnswerKey already removes
  // it; it is re-destructured rather than assumed so this module stays safe
  // even if that shared list is ever narrowed. Everything else in config
  // (caseSensitive, isQuiz, timeLimitSec) is rendering state the player's own
  // input field needs, and gives nothing away.
  sanitizeConfig(config) {
    if (!config || typeof config !== "object") return config;
    const { acceptedAnswers, ...safe } = stripAnswerKey(config);
    return safe;
  },

  validate: (_config, value) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= MAX_LEN,

  aggregate(config, responses: RawResponse[]) {
    const caseSensitive = !!config?.caseSensitive;
    const key = acceptedSet(config);

    // Grouping is ALWAYS case-folded, even on a case-sensitive slide: the
    // stage is showing the room what people typed, and splitting "paris" from
    // "Paris" into two bars just makes the popular answer look unpopular.
    const groups = new Map<string, { text: string; count: number }>();
    let correctCount = 0;

    for (const r of responses) {
      const v = parse(r.value);
      if (typeof v !== "string" || v.trim().length === 0) continue;

      const display = v.trim().replace(/\s+/g, " ");
      const groupKey = display.toLocaleLowerCase();
      const existing = groups.get(groupKey);
      // First spelling seen wins the label, so the bar doesn't rename itself
      // every time a new response lands.
      if (existing) existing.count++;
      else groups.set(groupKey, { text: display, count: 1 });

      if (key.has(normalize(v, caseSensitive))) correctCount++;
    }

    const answers = [...groups.values()].sort((a, b) => b.count - a.count);
    return { type: "TYPE_ANSWER", answers, correctCount, total: responses.length };
  },

  grade(config, value, ctx) {
    if (!config?.isQuiz) return { correct: false, points: 0 };
    if (typeof value !== "string") return { correct: false, points: 0 };
    const key = acceptedSet(config);
    if (key.size === 0) return { correct: false, points: 0 };
    if (!key.has(normalize(value, !!config.caseSensitive))) return { correct: false, points: 0 };
    return { correct: true, points: speedPoints(config.timeLimitSec ?? 20, ctx) };
  },

  isTimed: (config) => !!config?.isQuiz,
  timeLimitSec: (config) => config?.timeLimitSec ?? 20,

  revealPayload: (config) => ({ acceptedAnswers: acceptedList(config) }),

  formatForExport: (_config, value) => String(value ?? ""),
};

/** The accepted answers, trimmed and with blanks dropped. */
function acceptedList(config: any): string[] {
  const raw = Array.isArray(config?.acceptedAnswers) ? config.acceptedAnswers : [];
  return raw
    .filter((a: unknown): a is string => typeof a === "string")
    .map((a: string) => a.trim().replace(/\s+/g, " "))
    .filter((a: string) => a.length > 0);
}

function acceptedSet(config: any): Set<string> {
  const caseSensitive = !!config?.caseSensitive;
  return new Set(acceptedList(config).map((a) => normalize(a, caseSensitive)));
}

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
