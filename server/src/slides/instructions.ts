import type { SlideServerDef } from "./types.js";

// "How to join" (server half).
//
// Non-interactive like the rest of the content group, and its config is empty
// by design — the live join code belongs to the session, not to a slide, so
// there is nothing here for an author to put out of date.

export const contentInstructions: SlideServerDef = {
  type: "CONTENT_INSTRUCTIONS",
  interactive: false,
  // Required by the contract; unreachable, because a non-interactive slide
  // never accumulates responses.
  aggregate: () => ({ type: "CONTENT_INSTRUCTIONS", total: 0 }),
};
