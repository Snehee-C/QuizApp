import type { CSSProperties, ReactNode } from "react";
import { Shape } from "../components/ui/Shape";
import { slotFor } from "../lib/answers";

// The read-only echo of a player's own stored answer — the render half of
// `PlayerProps.value`.
//
// Why it lives in the slide modules at all: a phone that reconnects mid-slide
// gets `myAnswer` back on the join ack, but that value is `2`, or `[1,0,2]`, or
// `{x:0.31,y:0.78}`. Only the module knows that `2` means the circle, slot C,
// "Copenhagen" — so only the module can turn it into something a human
// recognises. The shell can say "already answered"; it cannot say what.
//
// Two rules this frame exists to enforce, both learned the hard way:
//
//  1. It must NEVER imply correctness. The reveal owns that moment. A "your
//     pick" marker that borrowed the correct/wrong vocabulary — lime glow + ✓,
//     desaturate + ✕ (DESIGN.md §5) — would either leak the answer key before
//     the reveal fires or flatly lie to someone who got it right. Everything
//     here is neutral surface and ink: no accent, no glow, no dimming.
//
//  2. It shows ONLY what the player chose, never the options they passed over.
//     Rendering the whole set with the unpicked entries dimmed is the obvious
//     alternative and it is wrong twice: dimming IS the app's "incorrect"
//     language, and the four redundant channels (hue + shape + letter + fixed
//     position, DESIGN.md §5) exist to separate options *from each other within
//     a set* — with no set on screen there is nothing to separate, and a single
//     row carrying its own hue, shape, letter and label text is already
//     complete without colour doing any work alone.
//
// Nothing here is interactive. `value` arriving at all means the server has
// already banked this response; `participant:submit` upserts, so one stray tap
// on a live control would overwrite a scored answer with a late zero-point one.

export function AnsweredEcho({
  label = "Your answer",
  children,
}: {
  /** Overridden where "answer" reads oddly — "Your guess", "Your ranking". */
  label?: string;
  children: ReactNode;
}) {
  return (
    // `echo-card` / `echo-row` below are forced-colours hooks only. Both
    // surfaces here are separated from their parent by a box-shadow hairline or
    // by one step of the canvas ladder, and forced colours discards box-shadow
    // and flattens the ladder to a single Canvas — so without an outline the
    // frame and every row inside it dissolve into the page. index.css restates
    // them as neutral CanvasText boundaries and nothing else: Highlight and
    // GrayText are the palette's words for "selected" and "not this one", and
    // this frame is on screen BEFORE the reveal, so either would be the exact
    // thing rule 1 above forbids it from saying.
    <div className="echo-card w-full flex flex-col gap-2.5 rounded-lg bg-surface-1 shadow-line px-4 py-4">
      <p className="text-caption font-semibold uppercase track-label text-ink-subtle">{label}</p>
      {children}
    </div>
  );
}

/**
 * One echoed option, carrying the slot's hue, shape and letter alongside the
 * author's own label text. The letter is `aria-hidden` on the badge and spoken
 * from inside the label instead, so a screen reader reads "C. Copenhagen" once
 * rather than announcing a stray letter after the words.
 */
export function EchoOption({
  index,
  label,
  lead,
  trail,
}: {
  index: number;
  label: string;
  /** e.g. a rank position, rendered before the shape badge. */
  lead?: ReactNode;
  /** e.g. a points allocation, rendered after the label. */
  trail?: ReactNode;
}) {
  const slot = slotFor(index);
  return (
    <div className="echo-row flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2.5">
      {lead}
      <span
        className="echo-chip shrink-0 grid place-items-center rounded-sm w-9 h-9"
        // The custom properties are read back by the forced-colours block in
        // index.css, which cannot recover the pair from `currentColor` once the
        // UA has forced it. This chip is the one element in the echo whose
        // content IS colour, so it is also the one allowed to keep it.
        style={
          {
            background: slot.fill,
            color: slot.ink,
            "--slot-fill": slot.fill,
            "--slot-ink": slot.ink,
          } as CSSProperties
        }
        aria-hidden="true"
      >
        <Shape shape={slot.shape} size={16} />
      </span>
      <span className="flex-1 text-callout font-semibold leading-tight break-words">
        <span className="sr-only">{slot.letter}. </span>
        {label}
      </span>
      {trail}
      {/* The letter channel (DESIGN.md §5) — meaningful content, not chrome —
        * so it owes the player-text contract in §6 in full: >=14px and >=4.5:1.
        * It was `text-footnote` + `--ink-subtle` and missed both, at 13px and
        * 4.41:1 on `--surface-2`. There is no 14px rung (the ladder steps 13
        * `footnote` -> 15 `subhead`), so the fix is the next step up rather
        * than an invented size, and `--ink-muted` takes it to 8.00:1 on Stage
        * Dark / 7.08:1 on Stage Light. It stays one ink step below the label
        * beside it, so it still reads as the quieter of the two. */}
      <span className="shrink-0 text-subhead font-bold text-ink-muted" aria-hidden="true">
        {slot.letter}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coercions.
//
// `value` is typed `unknown` on purpose: it is a round-trip of whatever the
// server stored, so it is only as well-formed as that slide's `validate` was on
// the day the row was written — and a deck edited between sessions can hand a
// module an index that no longer has an option. Every coercion below returns
// `null` rather than throwing or rendering a blank, because the caller's
// fallback (its normal input, or the shell's plain lock card) is always safe.
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** `number` | `number[]` → option indices. Null unless at least one survives. */
export function asIndexList(value: unknown): number[] | null {
  const raw = Array.isArray(value) ? value : [value];
  const out = raw.filter(
    (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0
  );
  return out.length ? out : null;
}

/** A single finite number — a scale rating, a guess. */
export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A per-option numeric array — a 100-points allocation. Null if any entry is not a number. */
export function asNumberList(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((n) => typeof n === "number" && Number.isFinite(n))
    ? (value as number[])
    : null;
}

/** A normalised 0–1 coordinate. Clamped, because a stale value must still land on the canvas. */
export function asPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp01(x), y: clamp01(y) };
}

/** Non-empty trimmed strings — word-cloud submissions. */
export function asWordList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    .map((w) => w.trim());
  return out.length ? out : null;
}
