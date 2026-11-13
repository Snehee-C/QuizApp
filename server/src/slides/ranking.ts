import type { SlideServerDef, RawResponse, ConfigIssue } from "./types.js";
import { checkStringList, MAX_ANSWER_SLOTS, ANSWER_SLOT_WHY } from "./types.js";

// Ranking — each player submits a permutation of the item indices, best first.
//
// Aggregated with a Borda count: an item placed 1st of N earns N-1 points, 2nd
// earns N-2, last earns 0. Borda uses every position in every ballot, so an
// item that is nobody's favourite but everybody's second choice still outranks
// a divisive one — which is the result a room expects from "rank these".
export const ranking: SlideServerDef = {
  type: "RANKING",
  interactive: true,

  validate(config, value) {
    const n = (config?.items ?? []).length;
    if (!Array.isArray(value) || value.length !== n) return false;
    // A ballot must be a permutation: every item ranked exactly once, or the
    // Borda totals stop being comparable between players.
    const seen = new Set<number>();
    for (const v of value) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= n) return false;
      if (seen.has(v)) return false;
      seen.add(v);
    }
    return true;
  },

  // A ballot must be a permutation of `items`, so the item list IS the slide:
  // with fewer than two entries there is nothing to order. The ceiling is the
  // stage's, not this type's — ranking.tsx draws every item in a `slotFor`
  // slot, so a seventh item wears the first one's colour, shape and letter.
  validateConfig: (config): ConfigIssue[] =>
    checkStringList(config, "items", {
      min: 2,
      label: "the items to rank",
      max: MAX_ANSWER_SLOTS,
      maxWhy: ANSWER_SLOT_WHY,
    }),

  aggregate(config, responses: RawResponse[]) {
    const items: string[] = config?.items ?? [];
    const n = items.length;
    const scores = new Array(n).fill(0);

    for (const r of responses) {
      const v = parse(r.value);
      // Skip ballots whose length no longer matches the config — the host can
      // add or remove an item while responses are already in the database.
      if (!Array.isArray(v) || v.length !== n) continue;
      for (let pos = 0; pos < n; pos++) {
        const item = v[pos];
        if (typeof item === "number" && item >= 0 && item < n) scores[item] += n - 1 - pos;
      }
    }

    // Ties break on item index so the stage order is stable across polls
    // rather than flickering on every recompute.
    const order = scores
      .map((_, i) => i)
      .sort((a, b) => scores[b] - scores[a] || a - b);

    return { type: "RANKING", items, scores, order, total: responses.length };
  },

  formatForExport(config, value) {
    const items: string[] = config?.items ?? [];
    const picks = Array.isArray(value) ? value : [];
    return picks.map((p) => items[p as number] ?? String(p)).join(" > ");
  },
};

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
