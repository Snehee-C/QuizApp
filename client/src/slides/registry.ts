// The slide-type registry (client half).
//
// To add a type: write ./<name>.tsx implementing SlideTypeDef, import it here,
// and add it to the array. Nothing else in the client should branch on
// slide.type.

import type { SlideTypeDef } from "./types";

import { multipleChoice } from "./multipleChoice";
import { wordCloud } from "./wordCloud";
import { scale } from "./scale";
import { openEnded } from "./openEnded";
import { ranking } from "./ranking";
import { hundredPoints } from "./hundredPoints";
import { grid2x2 } from "./grid2x2";
import { pinOnImage } from "./pinOnImage";
import { guessNumber } from "./guessNumber";
import { typeAnswer } from "./typeAnswer";
import {
  contentHeading,
  contentBullets,
  contentQuote,
  contentBigNumber,
  contentImage,
} from "./content";
import { contentInstructions } from "./instructions";
import { spinWheel } from "./spinWheel";

// Order here is the order of the editor's add-slide menu, within each group.
const MODULES: SlideTypeDef[] = [
  multipleChoice,
  wordCloud,
  scale,
  openEnded,
  ranking,
  hundredPoints,
  grid2x2,
  pinOnImage,
  guessNumber,
  typeAnswer,
  contentHeading,
  contentBullets,
  contentQuote,
  contentBigNumber,
  contentImage,
  contentInstructions,
  spinWheel,
];

const BY_TYPE = new Map<string, SlideTypeDef>(MODULES.map((m) => [m.type, m]));

export function slideType(type: string): SlideTypeDef | undefined {
  return BY_TYPE.get(type);
}

export const ALL_SLIDE_TYPES = MODULES;

/** Add-slide menu groupings, in display order. */
export const SLIDE_GROUPS: { key: SlideTypeDef["group"]; label: string }[] = [
  { key: "interactive", label: "Ask the room" },
  { key: "quiz", label: "Quiz" },
  { key: "content", label: "Content" },
];

export function typesInGroup(group: SlideTypeDef["group"]): SlideTypeDef[] {
  return MODULES.filter((m) => m.group === group);
}

export function labelFor(type: string): string {
  return slideType(type)?.label ?? type;
}

export function isInteractive(type: string): boolean {
  return slideType(type)?.interactive ?? false;
}
