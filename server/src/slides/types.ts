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

export function speedPoints(
  timeLimitSec: number,
  ctx: GradeContext,
  min = MIN_POINTS,
  max = MAX_POINTS
): number {
  const limitMs = Math.max(1, timeLimitSec * 1000);
  const startedAt = ctx.slideStartedAt ?? ctx.now;
  const elapsed = Math.max(0, Math.min(ctx.now - startedAt, limitMs));
  const speed = 1 - elapsed / limitMs; // 1 = instant, 0 = used the whole clock
  return Math.round(min + (max - min) * speed);
}
