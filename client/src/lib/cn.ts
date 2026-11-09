import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `cn(...)`: merges conditional classes (clsx) and resolves conflicting
// Tailwind utilities (tailwind-merge) so the last one wins.
//
// tailwind-merge has to be TAUGHT about our custom font sizes. Out of the box
// it cannot tell `text-body` (a size, from tailwind.config.js) from `text-ink`
// (a colour) — both are `text-*` with an unrecognised suffix — so it treats
// them as conflicting and silently drops the size. The symptom is text quietly
// rendering at the browser default instead of its ladder step, anywhere the two
// are combined through cn(). That is not hypothetical: it hit eight stage call
// sites before this existed. Registering them as font sizes makes the two
// groups independent again.
//
// INVARIANT: this list is every key under `theme.extend.fontSize` in
// tailwind.config.js. Adding a step there without adding it here reintroduces
// the silent-drop bug. `npm run lint:design` fails if the two drift.
const FONT_SIZES = [
  // The UI ladder (DESIGN.md §4)
  "caption2",
  "caption",
  "footnote",
  "subhead",
  "callout",
  "body",
  "title3",
  "title2",
  "title1",
  "large-title",
  "display",
  "hero",
  "hero-sub",
  // The stage ladder (DESIGN.md §5)
  "stage-code",
  "stage-q",
  "stage-q-sm",
  "stage-answer",
  "stage-name",
  "stage-label",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SIZES }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
