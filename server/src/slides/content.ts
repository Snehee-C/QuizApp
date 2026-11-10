import type { SlideServerDef, ConfigIssue } from "./types.js";
import {
  broken,
  incomplete,
  checkImageUrl,
  checkOptionalString,
  checkStringList,
  describe,
} from "./types.js";

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
  // The heading itself lives in `question`, which every type shares and the
  // envelope already checks; config only carries an optional subtitle.
  validateConfig: (config): ConfigIssue[] => checkOptionalString(config, "subtitle"),
  aggregate: () => emptyAggregate("CONTENT_HEADING"),
};

export const contentBullets: SlideServerDef = {
  type: "CONTENT_BULLETS",
  interactive: false,
  // With no bullets the slide is a heading over empty space.
  validateConfig: (config): ConfigIssue[] =>
    checkStringList(config, "bullets", { min: 1, label: "the bullet lines" }),
  aggregate: () => emptyAggregate("CONTENT_BULLETS"),
};

export const contentQuote: SlideServerDef = {
  type: "CONTENT_QUOTE",
  interactive: false,
  // The quote itself is `question`; config only carries who said it.
  validateConfig: (config): ConfigIssue[] => checkOptionalString(config, "attribution"),
  aggregate: () => emptyAggregate("CONTENT_QUOTE"),
};

export const contentBigNumber: SlideServerDef = {
  type: "CONTENT_BIG_NUMBER",
  interactive: false,
  // `value` is a STRING, not a number: the whole point of the type is to fill
  // the screen with "72%" or "1.4bn", which no numeric type can hold.
  validateConfig(config): ConfigIssue[] {
    const issues: ConfigIssue[] = [...checkOptionalString(config, "caption")];
    const v = config?.value;
    if (v === undefined || (typeof v === "string" && v.trim() === "")) {
      issues.push(incomplete("config.value is missing — it is the figure filling the screen."));
    } else if (typeof v !== "string") {
      issues.push(
        broken(
          `config.value must be a STRING such as "72%" or "1.4bn", got ${describe(v)}.`
        )
      );
    }
    return issues;
  },
  aggregate: () => emptyAggregate("CONTENT_BIG_NUMBER"),
};

export const contentImage: SlideServerDef = {
  type: "CONTENT_IMAGE",
  interactive: false,
  validateConfig: (config): ConfigIssue[] => [
    ...checkImageUrl(config, "imageUrl", "the slide is otherwise blank"),
    ...checkOptionalString(config, "caption"),
  ],
  aggregate: () => emptyAggregate("CONTENT_IMAGE"),
};
