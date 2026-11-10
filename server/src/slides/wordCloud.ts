import type { SlideServerDef, RawResponse, ConfigIssue } from "./types.js";
import { broken } from "./types.js";

export const wordCloud: SlideServerDef = {
  type: "WORD_CLOUD",
  interactive: true,

  validate(config, value) {
    const words = Array.isArray(value) ? value : [value];
    if (words.length === 0) return false;
    if (words.length > (config?.maxWords ?? 3)) return false;
    return words.every((w) => typeof w === "string" && w.trim().length > 0 && w.length <= 40);
  },

  // `maxWords` is an upper bound that validate() compares with `>`, so a value
  // below 1 rejects every possible submission — the slide takes no words at
  // all. Absent is fine: validate() falls back to 3.
  validateConfig(config): ConfigIssue[] {
    const v = config?.maxWords;
    if (v === undefined) return [];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      return [
        broken(
          `config.maxWords must be a whole number of 1 or more, got ${JSON.stringify(v) ?? "nothing"}. Below 1 every submission is rejected and the cloud stays empty.`
        ),
      ];
    }
    return [];
  },

  aggregate(_config, responses: RawResponse[]) {
    const freq: Record<string, number> = {};
    for (const r of responses) {
      const v = parse(r.value);
      for (const w of Array.isArray(v) ? v : [v]) {
        if (typeof w === "string" && w.trim()) {
          // Case-folded so "Chaotic" and "chaotic" are one word, which is the
          // whole point of a word cloud.
          const key = w.trim().toLowerCase();
          freq[key] = (freq[key] ?? 0) + 1;
        }
      }
    }
    const words = Object.entries(freq)
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count);
    return { type: "WORD_CLOUD", words, total: responses.length };
  },

  formatForExport: (_c, value) => (Array.isArray(value) ? value.join("; ") : String(value)),
};

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
