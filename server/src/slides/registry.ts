// The slide-type registry (server half).
//
// To add a type: write ./<name>.ts implementing SlideServerDef, import it
// here, and add it to the array. Nothing else on the server should branch on
// slide.type.

import type { SlideServerDef, GradeContext, Graded, RawResponse } from "./types.js";
import { stripAnswerKey } from "./types.js";

import { multipleChoice } from "./multipleChoice.js";
import { wordCloud } from "./wordCloud.js";
import { scale } from "./scale.js";
import { openEnded } from "./openEnded.js";
import { ranking } from "./ranking.js";
import { hundredPoints } from "./hundredPoints.js";
import { grid2x2 } from "./grid2x2.js";
import { pinOnImage } from "./pinOnImage.js";
import { guessNumber } from "./guessNumber.js";
import { typeAnswer } from "./typeAnswer.js";
import {
  contentHeading,
  contentBullets,
  contentQuote,
  contentBigNumber,
  contentImage,
} from "./content.js";
import { contentInstructions } from "./instructions.js";
import { spinWheel } from "./spinWheel.js";

const MODULES: SlideServerDef[] = [
  // ask the room
  multipleChoice,
  wordCloud,
  scale,
  openEnded,
  ranking,
  hundredPoints,
  grid2x2,
  pinOnImage,
  // scored
  guessNumber,
  typeAnswer,
  // content (non-interactive)
  contentHeading,
  contentBullets,
  contentQuote,
  contentBigNumber,
  contentImage,
  contentInstructions,
  spinWheel,
];

const BY_TYPE = new Map<string, SlideServerDef>(MODULES.map((m) => [m.type, m]));

export function slideDef(type: string): SlideServerDef | undefined {
  return BY_TYPE.get(type);
}

/** Every registered type — the allow-list the slide CRUD routes validate against. */
export const VALID_SLIDE_TYPES: string[] = MODULES.map((m) => m.type);

export function isInteractive(type: string): boolean {
  return slideDef(type)?.interactive ?? false;
}

/**
 * The config a PARTICIPANT is allowed to see. Unknown types fall back to the
 * default strip rather than passing the raw config through — failing closed
 * matters here, because this is the boundary that keeps answer keys off the
 * wire.
 */
export function publicConfig(type: string, config: any): any {
  const def = slideDef(type);
  return def?.sanitizeConfig ? def.sanitizeConfig(config) : stripAnswerKey(config);
}

export function validateValue(type: string, config: any, value: unknown): boolean {
  const def = slideDef(type);
  if (!def) return false;
  if (!def.interactive) return false;
  return def.validate ? def.validate(config, value) : true;
}

export function computeAggregate(type: string, config: any, responses: RawResponse[]): any {
  const def = slideDef(type);
  if (!def) return { type, total: responses.length };
  return def.aggregate(config, responses);
}

export function gradeSubmission(
  type: string,
  config: any,
  value: unknown,
  ctx: GradeContext
): Graded {
  const def = slideDef(type);
  if (!def?.grade) return { correct: false, points: 0 };
  return def.grade(config, value, ctx);
}

export function isTimed(type: string, config: any): boolean {
  const def = slideDef(type);
  return def?.isTimed ? def.isTimed(config) : false;
}

export function timeLimitSec(type: string, config: any): number {
  const def = slideDef(type);
  return def?.timeLimitSec ? def.timeLimitSec(config) : 20;
}

export function revealPayload(type: string, config: any): Record<string, unknown> {
  const def = slideDef(type);
  return def?.revealPayload ? def.revealPayload(config) : {};
}

export function formatForExport(type: string, config: any, value: unknown): string {
  const def = slideDef(type);
  if (def?.formatForExport) return def.formatForExport(config, value);
  if (Array.isArray(value)) return value.join("; ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}
