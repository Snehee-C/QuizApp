// Aggregation logic: turn raw responses into the compact shape the presenter renders.

interface RawResponse {
  participantId: string;
  value: string; // JSON string
}

export function computeAggregate(slideType: string, config: any, responses: RawResponse[]) {
  const values = responses.map((r) => safeParse(r.value));

  switch (slideType) {
    case "MULTIPLE_CHOICE": {
      const options: string[] = config.options ?? [];
      const counts = new Array(options.length).fill(0);
      for (const v of values) {
        // v is a number index or array of indices
        const picks = Array.isArray(v) ? v : [v];
        for (const p of picks) {
          if (typeof p === "number" && p >= 0 && p < counts.length) counts[p]++;
        }
      }
      return { type: slideType, options, counts, total: responses.length };
    }

    case "WORD_CLOUD": {
      const freq: Record<string, number> = {};
      for (const v of values) {
        const words = Array.isArray(v) ? v : [v];
        for (const w of words) {
          if (typeof w === "string" && w.trim()) {
            const key = w.trim().toLowerCase();
            freq[key] = (freq[key] ?? 0) + 1;
          }
        }
      }
      const words = Object.entries(freq)
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count);
      return { type: slideType, words, total: responses.length };
    }

    case "SCALE": {
      const min = config.scaleMin ?? 1;
      const max = config.scaleMax ?? 5;
      const dist: Record<number, number> = {};
      for (let i = min; i <= max; i++) dist[i] = 0;
      let sum = 0;
      let n = 0;
      for (const v of values) {
        if (typeof v === "number" && v >= min && v <= max) {
          dist[v]++;
          sum += v;
          n++;
        }
      }
      return {
        type: slideType,
        min,
        max,
        distribution: dist,
        average: n ? sum / n : 0,
        total: responses.length,
      };
    }

    case "OPEN_ENDED": {
      const texts = responses
        .map((r) => ({ participantId: r.participantId, text: safeParse(r.value) }))
        .filter((t) => typeof t.text === "string" && t.text.trim());
      return { type: slideType, texts, total: texts.length };
    }

    default:
      return { type: slideType, total: responses.length };
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
