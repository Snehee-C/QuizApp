import type { SlideServerDef, RawResponse, ConfigIssue } from "./types.js";
import {
  speedPoints,
  broken,
  incomplete,
  describe,
  checkStringList,
  checkOptionalBool,
  checkOptionalFiniteNumber,
} from "./types.js";

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

  // The answer key and the option list have to agree with each other AND with
  // `validate()` above. Every rule here is a way that agreement breaks:
  //
  //   * an index past the end of the list is correct for nobody, because
  //     `validate()` rejects any pick >= options.length;
  //   * two correct indices with allowMultiple off is UNWINNABLE — grading
  //     needs the pick set to equal the key, and `validate()` refuses to
  //     accept more than one pick, so no submission can ever satisfy both;
  //   * a duplicated index MIS-GRADES: `[0,0]` makes the key length 2, so the
  //     wrong answer `[0,1]` passes both `picks.length === key.length` and
  //     `key.every(k => picks.includes(k))` and is marked correct;
  //   * two options reading the same thing means the player tapping the
  //     visually identical twin is marked wrong in front of the room.
  //
  // Deliberately NOT checked: an answer key with `isQuiz` false. That is the
  // exact config `defaultConfig("MULTIPLE_CHOICE")` creates for every new
  // slide, so it is the normal state of an unfinished poll, not a defect.
  validateConfig(config): ConfigIssue[] {
    const issues: ConfigIssue[] = [
      ...checkStringList(config, "options", { min: 2, label: "the options" }),
      ...checkOptionalBool(config, "allowMultiple"),
      ...checkOptionalBool(config, "isQuiz"),
      ...checkOptionalFiniteNumber(config, "timeLimitSec"),
    ];

    const options: unknown[] = Array.isArray(config?.options) ? config.options : [];
    const labels = options
      .filter((o): o is string => typeof o === "string")
      .map((o) => o.trim().toLocaleLowerCase())
      .filter((o) => o !== "");
    const dupLabel = labels.find((l, i) => labels.indexOf(l) !== i);
    if (dupLabel !== undefined) {
      const quizzed = config?.isQuiz === true;
      const msg =
        `config.options lists the same answer twice (${JSON.stringify(dupLabel)}). ` +
        (quizzed
          ? "Only one of the two can be the correct index, so a player tapping the other identical option is marked wrong."
          : "The room's votes split across two identical bars.");
      issues.push(quizzed ? broken(msg) : incomplete(msg));
    }

    // `correctIndices` wins over `correctIndex` here exactly as grade() reads
    // them, so what is validated is what is scored.
    let key: unknown[] | null = null;
    if (config?.correctIndices !== undefined) {
      if (!Array.isArray(config.correctIndices)) {
        issues.push(
          broken(
            `config.correctIndices must be an array of option indexes (0 = the first option), got ${describe(config.correctIndices)}.`
          )
        );
      } else {
        key = config.correctIndices;
      }
    } else if (config?.correctIndex !== undefined) {
      if (typeof config.correctIndex !== "number" || !Number.isInteger(config.correctIndex)) {
        issues.push(
          broken(
            `config.correctIndex must be a whole number index, got ${describe(config.correctIndex)}.`
          )
        );
      } else {
        key = [config.correctIndex];
      }
    }

    if (key) {
      const n = options.length;
      const seen = new Set<number>();
      for (const k of key) {
        if (typeof k !== "number" || !Number.isInteger(k) || k < 0) {
          issues.push(
            broken(
              `config.correctIndices contains ${describe(k)}; every entry must be a whole number 0 or greater. It holds option INDEXES, never the answer text.`
            )
          );
          continue;
        }
        if (k >= n) {
          issues.push(
            broken(
              `config.correctIndices points at option ${k}, but there ${n === 1 ? "is" : "are"} only ${n} option${n === 1 ? "" : "s"} (indexes are 0-based, so the last one is ${n - 1}). Nobody can submit that answer.`
            )
          );
          continue;
        }
        if (seen.has(k)) {
          issues.push(
            broken(
              `config.correctIndices lists index ${k} twice. The duplicate inflates the key's length, so a wrong answer of the same size grades as correct.`
            )
          );
        }
        seen.add(k);
      }
      if (key.length > 1 && config?.allowMultiple !== true) {
        issues.push(
          broken(
            `config.correctIndices has ${key.length} correct answers but allowMultiple is ${describe(config?.allowMultiple)}. A player may only pick one option and grading needs the picks to equal the key exactly, so this question cannot be answered correctly by anyone. Set allowMultiple true, or keep one correct index.`
          )
        );
      }
    }

    if (config?.isQuiz === true && (!key || key.length === 0)) {
      issues.push(
        incomplete(
          "config.isQuiz is true but there is no correct answer set, so every player scores 0."
        )
      );
    }

    return issues;
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
