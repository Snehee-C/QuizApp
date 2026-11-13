import type { SlideServerDef, RawResponse, ConfigIssue } from "./types.js";
import { broken, checkStringList, describe, MAX_ANSWER_SLOTS, ANSWER_SLOT_WHY } from "./types.js";

// 100 points — each player splits a fixed budget across the options and
// submits the per-option allocation, in config order.
//
// The stage wants both figures: the summed totals set each bar's share of the
// room's whole budget, while the average is the only number that stays
// comparable as more people answer.
export const hundredPoints: SlideServerDef = {
  type: "HUNDRED_POINTS",
  interactive: true,

  validate(config, value) {
    const n = (config?.options ?? []).length;
    const budget = config?.total ?? 100;
    if (!Array.isArray(value) || value.length !== n) return false;
    let sum = 0;
    for (const v of value) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return false;
      sum += v;
    }
    // The budget must balance exactly. A partial allocation would silently
    // weigh that player less than everyone else in the averages.
    return sum === budget;
  },

  // `total` is the budget validate() requires every ballot to spend EXACTLY,
  // and each entry must be a non-negative integer — so a budget of 0 or less
  // is either unreachable or forces an all-zero allocation.
  validateConfig(config): ConfigIssue[] {
    const issues: ConfigIssue[] = [
      // Same stage ceiling as MULTIPLE_CHOICE and RANKING: hundredPoints.tsx
      // draws each option in a `slotFor` slot, which wraps at six.
      ...checkStringList(config, "options", {
        min: 2,
        label: "the options to split points across",
        max: MAX_ANSWER_SLOTS,
        maxWhy: ANSWER_SLOT_WHY,
      }),
    ];
    const total = config?.total;
    if (total !== undefined && (!Number.isInteger(total) || (total as number) <= 0)) {
      issues.push(
        broken(
          `config.total must be a whole number above 0, got ${describe(total)}. It is the budget every player has to spend exactly.`
        )
      );
    }
    return issues;
  },

  aggregate(config, responses: RawResponse[]) {
    const options: string[] = config?.options ?? [];
    const n = options.length;
    const totals = new Array<number>(n).fill(0);
    let counted = 0;

    for (const r of responses) {
      const v = parse(r.value);
      // Skip allocations whose length no longer matches the config — the host
      // can add or remove an option while responses are already stored.
      if (!Array.isArray(v) || v.length !== n) continue;
      for (let i = 0; i < n; i++) {
        const p = v[i];
        if (typeof p === "number" && Number.isFinite(p) && p >= 0) totals[i] += p;
      }
      counted++;
    }

    // Averaged over the ballots that counted, not over every row, so a
    // skipped malformed row doesn't drag every option's average down.
    const averages = totals.map((t) => (counted ? t / counted : 0));

    return { type: "HUNDRED_POINTS", options, totals, averages, total: responses.length };
  },

  formatForExport(config, value) {
    const options: string[] = config?.options ?? [];
    const picks = Array.isArray(value) ? value : [];
    return picks.map((p, i) => `${options[i] ?? i}: ${p}`).join("; ");
  },
};

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
