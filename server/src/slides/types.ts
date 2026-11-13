// The slide-type contract (server half).
//
// Every slide type is a self-contained module implementing this interface and
// registered in ./registry.ts. Nothing outside a module should switch on
// `slide.type` — adding a type must mean adding a file, not editing six.
//
// Slide.type is stored as a plain String and Slide.config as a JSON string, so
// new types need no database migration.

export interface RawResponse {
  participantId: string;
  /** JSON string, shape decided by the owning module. */
  value: string;
}

export interface GradeContext {
  /** Wall-clock ms when the slide went live; null if unknown. */
  slideStartedAt: number | null;
  /** Server time when the answer arrived. */
  now: number;
}

export interface Graded {
  correct: boolean;
  points: number;
}

/**
 * Something wrong with an authored config, and how wrong.
 *
 *   "broken"     — the value contradicts itself or the rest of the config, and
 *                  is not a state an author passes THROUGH on the way to a
 *                  finished slide: a correct index past the end of the option
 *                  list, a scale whose max is below its min, two correct
 *                  answers on a single-select. These can only ever be refused.
 *
 *   "incomplete" — a required field that has not been filled in yet. Blank is
 *                  exactly what a half-authored slide looks like, so this is
 *                  only a refusal where the deck is a FINISHED artifact (an
 *                  uploaded file). The editor must stay able to save a slide
 *                  the author is still writing.
 *
 * The split is load-bearing, not cosmetic: the server's own `defaultConfig()`
 * creates RANKING and PIN_ON_IMAGE slides with an empty config, so treating
 * "incomplete" as a hard error everywhere would make those types impossible
 * to create.
 */
export type ConfigIssueKind = "broken" | "incomplete";

export interface ConfigIssue {
  kind: ConfigIssueKind;
  /** Written for the host who has to fix the deck, not for a log. */
  message: string;
}

export const broken = (message: string): ConfigIssue => ({ kind: "broken", message });
export const incomplete = (message: string): ConfigIssue => ({ kind: "incomplete", message });

/** How a wrong value is described back to the author. */
export function describe(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "nothing";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "object") return "an object";
  return JSON.stringify(v);
}

/**
 * The stage has SIX answer slots, so six is the most options a slide may
 * offer. This is not a taste limit, it is the cardinality of the design
 * system: `client/src/lib/answers.ts` defines `ANSWER_SLOTS` with six entries
 * and resolves a slot with `index % 6`, so option 7 is handed slot A's hue,
 * slot A's shape AND slot A's letter. DESIGN.md §6 promises "four redundant
 * channels on every answer (hue + shape + letter + fixed screen position)";
 * past six all four wrap together and the promise is simply false — a player
 * told to pick "A" has two tiles to choose from.
 *
 * Measured on the real stage at 1920x1080 with 26 options: the letter channel
 * reads A B C D E F A B C D E F A B …, the grid starts 372px ABOVE the top of
 * the viewport (so the question is not on screen at all) and 105 elements are
 * painted outside it. The editor has always known this number
 * (`client/src/slides/multipleChoice.tsx`, `disabled={options.length >= 6}`,
 * and the same line in ranking.tsx and hundredPoints.tsx); the importer did
 * not, which is the whole of the defect.
 */
export const MAX_ANSWER_SLOTS = 6;

/** The explanation that goes with it, shared by every slot-driven list. */
export const ANSWER_SLOT_WHY =
  `the stage has ${MAX_ANSWER_SLOTS} answer slots and reuses them from the top, so entry ${MAX_ANSWER_SLOTS + 1} ` +
  `is drawn in slot A's colour, shape and letter — the room sees two tiles marked "A"`;

/**
 * The longest an option label may be, in characters.
 *
 * Derived from the one rendering constraint that actually stops:
 * `StageAnswers.tsx` fits every label to the largest size at which none of
 * them exceeds `MAX_LINES` (3), binary-searching DOWN from the
 * `stage-answer` ladder step and refusing to go below `ANSWER_FLOOR` (26px,
 * that step's own clamp minimum). At the floor it stops caring: a longer
 * label simply takes a fourth line, a fifth, a ninth.
 *
 * Measured on the real stage at 1920x1080 — the size DESIGN.md §4 says the
 * stage scale is designed at — with six options, which is the tightest legal
 * case. The label column is 634px. Ordinary mixed-case text fills exactly
 * three lines at 134 characters and spills to four at 136.
 *
 * 120 is that measured capacity rounded down, which buys back the roughly 10%
 * the sample flattered it by (evenly spaced five-letter words wrap better than
 * real labels do) and holds at and above the design size — measured with six
 * options at 120 characters:
 *
 *     3840 x 2160   3 lines   label column 1475px
 *     2560 x 1080   3 lines   label column  902px
 *     1920 x 1080   3 lines   label column  634px   <- the anchor
 *     1366 x  768   4 lines   label column  449px
 *
 * It is a ceiling, not a promise of perfect wrap, and the last row is the
 * honest half of that. BELOW the design size the column shrinks while the
 * floor does not, so the three-line contract is already gone at 100
 * characters there and no character count rescues it. Nor does one describe
 * glyph width: 120 characters of wide capitals takes four lines even at
 * 1920x1080 (measured: `WMWM…` runs out of three lines at 100). Past the
 * floor the stage keeps its 26px minimum and the tile simply grows, which
 * DESIGN.md §4 already calls a CONTENT problem rather than a typographic one.
 *
 * What the cap stops is the categorical case: 400 characters on six options
 * pushes the grid 138px below the bottom of a 1080p viewport (measured), into
 * the ~8% §5 says the audience's heads are blocking anyway.
 */
export const MAX_OPTION_LABEL = 120;

/**
 * The shared shape behind `options` / `items` / `entries` / `bullets`: a list
 * of non-blank strings that the slide renders verbatim.
 */
export function checkStringList(
  config: any,
  key: string,
  opts: {
    min: number;
    label: string;
    /** Most entries the stage can draw. Omit where no measured limit exists. */
    max?: number;
    /** Why `max` is what it is, in the host's terms. */
    maxWhy?: string;
    /** Longest one entry may be, in characters. */
    maxEntry?: number;
    /** Why `maxEntry` is what it is, in the host's terms. */
    maxEntryWhy?: string;
  }
): ConfigIssue[] {
  const v = config?.[key];
  if (v === undefined) {
    return [incomplete(`config.${key} is missing — ${opts.label} is what this slide renders.`)];
  }
  if (!Array.isArray(v)) {
    return [broken(`config.${key} must be an array of strings, got ${describe(v)}.`)];
  }
  const issues: ConfigIssue[] = [];
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string") {
      issues.push(broken(`config.${key}[${i}] must be a string, got ${describe(v[i])}.`));
    } else if (v[i].trim() === "") {
      issues.push(incomplete(`config.${key}[${i}] is blank — it renders as an empty slot.`));
    } else if (opts.maxEntry !== undefined && v[i].length > opts.maxEntry) {
      // "broken", not "incomplete": nobody types 400 characters on the way to
      // a 20-character label, and the value cannot be rendered as written.
      issues.push(
        broken(
          `config.${key}[${i}] is ${v[i].length} characters; the most the stage can set is ${opts.maxEntry}` +
            `${opts.maxEntryWhy ? ` — ${opts.maxEntryWhy}` : ""}.`
        )
      );
    }
  }
  if (v.length < opts.min) {
    issues.push(
      incomplete(
        `config.${key} has ${v.length} entr${v.length === 1 ? "y" : "ies"}; this type needs at least ${opts.min}.`
      )
    );
  }
  if (opts.max !== undefined && v.length > opts.max) {
    // "broken", not "incomplete": there is no route to a finished slide that
    // passes THROUGH seven options, and the editor refuses to create one.
    issues.push(
      broken(
        `config.${key} has ${v.length} entries; this type renders at most ${opts.max}` +
          `${opts.maxWhy ? ` — ${opts.maxWhy}` : ""}.`
      )
    );
  }
  return issues;
}

/** A field that may be absent, but must be text when present. */
export function checkOptionalString(config: any, key: string): ConfigIssue[] {
  const v = config?.[key];
  if (v === undefined || typeof v === "string") return [];
  return [broken(`config.${key} must be a string, got ${describe(v)}.`)];
}

/** A field that may be absent, but must be a real boolean when present. */
export function checkOptionalBool(config: any, key: string): ConfigIssue[] {
  const v = config?.[key];
  if (v === undefined || typeof v === "boolean") return [];
  return [broken(`config.${key} must be true or false, got ${describe(v)}.`)];
}

/** A field that may be absent, but must be a finite number when present. */
export function checkOptionalFiniteNumber(config: any, key: string): ConfigIssue[] {
  const v = config?.[key];
  if (v === undefined) return [];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return [broken(`config.${key} must be a finite number, got ${describe(v)}.`)];
  }
  return [];
}

/**
 * An image the slide cannot render is the same as no image at all, and the
 * failure only shows up on the projector. Accepts what a browser will actually
 * fetch from this app: absolute http(s), an inline data image, or a
 * same-origin path.
 */
export function checkImageUrl(config: any, key: string, why: string): ConfigIssue[] {
  const v = config?.[key];
  if (v === undefined || (typeof v === "string" && v.trim() === "")) {
    return [incomplete(`config.${key} is missing — ${why}.`)];
  }
  if (typeof v !== "string") {
    return [broken(`config.${key} must be a string URL, got ${describe(v)}.`)];
  }
  const url = v.trim();
  if (!/^(https?:\/\/|data:image\/|\/)/i.test(url)) {
    return [
      broken(
        `config.${key} will not load: it must start with http(s)://, data:image/ or "/" (same-origin).`
      ),
    ];
  }
  return [];
}

export interface SlideServerDef {
  /** Wire value, e.g. "RANKING". Must match the client module's `type`. */
  type: string;

  /**
   * False for content slides (headings, images, quotes). Non-interactive
   * slides reject `participant:submit` and never arm a reveal timer.
   */
  interactive: boolean;

  /**
   * Remove anything that would give away the answer before the reveal. The
   * result is what participants receive — their browsers can read any socket
   * frame, so an answer key left in here is a cheat, not a cosmetic issue.
   * Defaults to stripping `correctIndices` / `correctIndex`.
   */
  sanitizeConfig?: (config: any) => any;

  /** Reject malformed values before they reach the database. */
  validate?: (config: any, value: unknown) => boolean;

  /**
   * Reject a malformed CONFIG before it reaches the database — the authoring
   * half of `validate()`, which only ever sees a player's submitted value.
   *
   * Everything above assumes the config is sane and a deck that is already
   * stored is already too late: `validate()` rejecting every submission, or
   * `grade()` marking the wrong pick correct, is discovered in front of a
   * room. Each type owns this next to its own `validate()`/`grade()` so the
   * rule and the thing it protects cannot drift apart.
   *
   * Returns every problem found, not the first — an author fixing one at a
   * time and re-uploading is the behaviour this is meant to replace. An empty
   * array means the config is playable.
   */
  validateConfig?: (config: any) => ConfigIssue[];

  /** Turn raw responses into the compact payload the stage renders. */
  aggregate: (config: any, responses: RawResponse[]) => any;

  /** Score a submission. Omit for types that are never scored. */
  grade?: (config: any, value: unknown, ctx: GradeContext) => Graded;

  /** Whether this slide runs a countdown and auto-reveals when it expires. */
  isTimed?: (config: any) => boolean;

  /** Countdown length. Only consulted when isTimed() is true. */
  timeLimitSec?: (config: any) => number;

  /**
   * What to broadcast when the answer is revealed — merged into the
   * `slide:reveal` payload. This is the ONLY path by which an answer key may
   * reach participants.
   */
  revealPayload?: (config: any) => Record<string, unknown>;

  /** One row per response for CSV export. Defaults to JSON-ish flattening. */
  formatForExport?: (config: any, value: unknown) => string;
}

/** The default answer-key strip, used when a module doesn't override it. */
export function stripAnswerKey(config: any): any {
  if (!config || typeof config !== "object") return config;
  const { correctIndices, correctIndex, acceptedAnswers, correctValue, ...safe } = config;
  return safe;
}

/**
 * Mentimeter-style speed scoring: a correct answer earns 500–1000 points
 * depending on how quickly it arrived relative to the slide's time limit.
 * Shared so every quiz-capable type scores on the same curve.
 */
export const MIN_POINTS = 500;
export const MAX_POINTS = 1000;

/**
 * The bounds any countdown is held to, before `timeScale` stretches it.
 *
 * Nothing validated this: `0` (a host who cleared the number field), a negative
 * value, and anything past `setTimeout`'s 2^31-1 ms signed range — which Node
 * silently clamps to 1 ms — all produced the same total failure, an auto-reveal
 * that fires on landing and a question that is dead before the room can read
 * it. The floor is deliberately a readable amount of time rather than 1 s; the
 * ceiling leaves room for the x3 accessibility stretch and still sits two
 * orders of magnitude inside the timer's range.
 */
export const MIN_TIME_LIMIT_SEC = 5;
export const MAX_TIME_LIMIT_SEC = 600;
export const DEFAULT_TIME_LIMIT_SEC = 20;

export function clampTimeLimitSec(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_TIME_LIMIT_SEC;
  return Math.min(MAX_TIME_LIMIT_SEC, Math.max(MIN_TIME_LIMIT_SEC, Math.round(n)));
}

export function speedPoints(
  timeLimitSec: number,
  ctx: GradeContext,
  min = MIN_POINTS,
  max = MAX_POINTS
): number {
  // Already clamped by the registry on the way in, and by `scaledLimit` when a
  // session stretches it — but grading must not be able to divide by a window
  // of zero no matter who calls it, so guard here too. The ceiling allows the
  // x3 stretch of the longest legal question.
  const safeLimit = Number.isFinite(timeLimitSec)
    ? Math.min(MAX_TIME_LIMIT_SEC * 3, Math.max(1, timeLimitSec))
    : DEFAULT_TIME_LIMIT_SEC;
  const limitMs = Math.max(1, safeLimit * 1000);
  const startedAt = ctx.slideStartedAt ?? ctx.now;
  const elapsed = Math.max(0, Math.min(ctx.now - startedAt, limitMs));
  const speed = 1 - elapsed / limitMs; // 1 = instant, 0 = used the whole clock
  return Math.round(min + (max - min) * speed);
}
