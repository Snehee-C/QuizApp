import type { SlideServerDef, RawResponse } from "./types.js";

export const openEnded: SlideServerDef = {
  type: "OPEN_ENDED",
  interactive: true,

  validate: (_c, value) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= 500,

  aggregate(_config, responses: RawResponse[]) {
    const texts = responses
      .map((r) => ({ participantId: r.participantId, text: parse(r.value) }))
      .filter((t): t is { participantId: string; text: string } =>
        typeof t.text === "string" && t.text.trim().length > 0
      );
    return { type: "OPEN_ENDED", texts, total: texts.length };
  },
};

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
