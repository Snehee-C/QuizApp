import type { SlideServerDef, RawResponse } from "./types.js";

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
