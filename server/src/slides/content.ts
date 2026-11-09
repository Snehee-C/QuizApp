import type { SlideServerDef } from "./types.js";

// Content slides (server half).
//
// These carry no answer key, run no clock and accept no submissions:
// `interactive: false` is what makes the socket layer reject
// `participant:submit` and skip arming a reveal timer, so the server side of a
// content type is almost entirely a declaration.
//
// `aggregate` can never be reached with responses — nothing can be stored
// against a non-interactive slide — but the contract requires the function, so
// each type returns the same empty shape rather than throwing. Failing quiet
// here matters: a presenter mid-session should not lose the deck because a
// stray aggregate recompute touched a heading.

/** Every content type's aggregate: the empty shape, tagged with its own type. */
function emptyAggregate(type: string) {
  return { type, total: 0 };
}

export const contentHeading: SlideServerDef = {
  type: "CONTENT_HEADING",
  interactive: false,
  aggregate: () => emptyAggregate("CONTENT_HEADING"),
};

export const contentBullets: SlideServerDef = {
  type: "CONTENT_BULLETS",
  interactive: false,
  aggregate: () => emptyAggregate("CONTENT_BULLETS"),
};

export const contentQuote: SlideServerDef = {
  type: "CONTENT_QUOTE",
  interactive: false,
  aggregate: () => emptyAggregate("CONTENT_QUOTE"),
};

export const contentBigNumber: SlideServerDef = {
  type: "CONTENT_BIG_NUMBER",
  interactive: false,
  aggregate: () => emptyAggregate("CONTENT_BIG_NUMBER"),
};

export const contentImage: SlideServerDef = {
  type: "CONTENT_IMAGE",
  interactive: false,
  aggregate: () => emptyAggregate("CONTENT_IMAGE"),
};
