import { motion } from "motion/react";
import { slotFor } from "../../lib/answers";
import { Shape } from "./Shape";
import { cn } from "../../lib/cn";
import { spring } from "../../lib/motion";

type State = "idle" | "correct" | "wrong" | "chosen";

interface AnswerTileProps {
  index: number;
  label: string;
  onClick?: () => void;
  state?: State;
  /** Stage tiles are bigger, carry no (nobody touches a projector). */
  stage?: boolean;
  disabled?: boolean;
  className?: string;
}

// A single answer option. Carries all four redundant channels (DESIGN.md §5):
// hue, shape, letter, and its fixed position in the grid.
//
// Correct/incorrect is never red/green: correct keeps its colour and gains a
// lime glow ring plus a check; wrong desaturates and dims. That clears the
// red/green trap and is emotionally softer than punishing someone in red.
//
// `chosen` — a multi-select pick, shown BEFORE the reveal — had to be built out
// of a third vocabulary, because the other two are both spoken for and both
// would lie: accent/glow/✓ would leak the answer key, and desaturate/dim/shrink
// would tell a player their pick was wrong while the clock is still running.
// The one it uses is "the tile's own ink fills in": an inset keyline, the shape
// chip inverting to solid, and the letter going to full strength. All three are
// ink-on-fill, which the slot ladder already measures at ≥6.4:1, so selection
// survives greyscale, every form of CVD, and a dying bulb on exactly the same
// terms as the four channels it sits beside — it is a luminance and fill
// change, not a hue change.
//
// Measured per slot in pure greyscale, keyline against its own fill:
//   A 9.20  B 6.52  C 6.98  D 9.98  E 7.86  F 8.54
// Worst case is slot C at 6.98:1 — bounded by that slot's FILL lightness, not
// by its near-black ink — which clears the 3:1 WCAG 1.4.11 non-text floor by
// 2.3x. Greyscale retains essentially all of the colour difference (slot C
// measures 6.97 in colour, 6.98 in grey), which is the property that matters:
// the channel does not depend on hue. Do not quote a single slot's figure as
// the system's; the spread is the claim. Nothing moves the tile's box, because
// the stage grid depends on all tiles measuring the same height.
//
// Forced colours (Windows High Contrast) are the one mode where this component
// cannot keep its own promises unaided: the UA substitutes the user's palette
// for every fill and ink and discards `box-shadow` outright, which deletes hue
// AND the keyline above in a single move and leaves six identical white
// rectangles with no boundary between them. The hooks below — `data-state`,
// `.answer-tile`, `.answer-keyline`, `.answer-chip`, `.answer-letter`,
// `.answer-stamp-*` — exist only so index.css can re-speak each of those states
// in the palette's own system colours. `--slot-fill` / `--slot-ink` are
// published alongside them because by the time those rules run `currentColor`
// has already been forced and the slot's own pair can no longer be read back.
export function AnswerTile({
  index,
  label,
  onClick,
  state = "idle",
  stage = false,
  disabled,
  className,
}: AnswerTileProps) {
  const slot = slotFor(index);
  const Tag = onClick ? motion.button : motion.div;
  const chosen = state === "chosen";

  return (
    <Tag
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      // Spoken, not just drawn. `aria-pressed` would be the toggle idiom, but
      // the component cannot tell a multi-select board from a pick-one board —
      // only the chosen tile knows it is one — so a tile that is merely `idle`
      // would be silently missing the attribute. Saying the word is honest in
      // both cases.
      aria-label={`${slot.letter}. ${label}${chosen ? ", selected" : ""}`}
      // An attribute rather than four more classes: the forced-colours rules
      // have to reach four distinct states on this one element, and a
      // class-per-state would be a second spelling of `state` (P1).
      data-state={state}
      initial={{ opacity: 0, y: 14 }}
      animate={{
        // 0.62, not 0.38. A wrong tile still carries its OPTION TEXT, which
        // the room reads after the answer lands — at 0.38/saturate(.15) that
        // text composited to 1.82-3.18:1 (worst: slot C), below even the 3:1
        // large-text bar. Solved: 0.62 with saturate(.25) clears 3:1 on every
        // slot; reaching 4.5:1 would need 0.82, which is barely dimmed at all
        // and would destroy the signal. The dim can afford to be gentler
        // because it is one of FOUR channels here — desaturate, dim, ✕ and
        // scale-down — so it never had to carry "incorrect" on its own.
        opacity: state === "wrong" ? 0.62 : 1,
        y: 0,
        scale: state === "correct" ? 1.04 : state === "wrong" ? 0.94 : 1,
      }}
      transition={{
        // The correct-answer stamp is one of the three budgeted overshoot
        // moments (DESIGN.md §4). A selection is not one of them — it is a
        // press, so it answers on the press spring.
        ...(state === "correct" ? spring.pop : chosen ? spring.fast : spring.default),
        delay: index * 0.045,
      }}
      className={cn(
        "answer-tile relative flex items-center text-left w-full overflow-hidden",
        "font-ui font-semibold",
        stage
          ? "rounded-xl gap-5 px-7 py-6 text-stage-answer"
          : "rounded-lg gap-4 px-5 py-5 text-title3 min-h-[88px] flex-1 max-h-[22vh]",
        !stage && onClick && !disabled && "press",
        state === "correct" && "shadow-glow z-10",
        state === "wrong" && "saturate-[0.25]",
        className
      )}
      style={
        {
          background: slot.fill,
          color: slot.ink,
          "--slot-deep": slot.deep,
          // Read back only by the forced-colours block in index.css; see above.
          "--slot-fill": slot.fill,
          "--slot-ink": slot.ink,
        } as React.CSSProperties
      }
    >
      {/* The selection keyline. An overlay rather than a border or a ring
        * utility: both of those would grow the box, and a recent fix depends on
        * every tile in a stage row measuring identically. An inset shadow never
        * participates in layout. Width is in `em` so it rides the type ladder
        * the way the glyphs below already do — ~3px against `text-title3` on the
        * phone, which is the keyline width the system uses for `--focus`, and
        * proportionally heavier against `text-stage-answer` so it still reads
        * from six metres. The radius is spelled with the same ladder step as the
        * tile: `overflow-hidden` clips the outer corners, but the shadow's INNER
        * corner is drawn from this element's own radius, and a square one would
        * leave the ring visibly thicker at each corner. */}
      {chosen && (
        <motion.span
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          // Press spring, because this is a press. Only opacity is animated:
          // `spring.fast` is ζ≈0.6 and does overshoot, and scaling the keyline
          // on it would be a fourth overshoot moment against a budget of three.
          transition={spring.fast}
          className={cn(
            "answer-keyline pointer-events-none absolute inset-0",
            stage ? "rounded-xl" : "rounded-lg"
          )}
          style={{ boxShadow: "inset 0 0 0 0.14em currentColor" }}
        />
      )}

      {/* letter + shape: the two non-colour channels */}
      <span
        className={cn(
          "answer-chip shrink-0 grid place-items-center rounded-md",
          stage ? "w-[1.6em] h-[1.6em]" : "w-11 h-11"
        )}
        // Chosen inverts the chip — solid ink with the shape knocked out of it,
        // the hollow-to-filled flip a checkbox makes, minus the check glyph
        // (that one belongs to the reveal). The two colours are the slot's own
        // measured pair, so the inversion keeps the shape channel at the same
        // contrast it had the other way round.
        style={
          chosen
            ? { background: slot.ink, color: slot.fill }
            : { background: "color-mix(in oklch, currentColor, transparent 86%)" }
        }
      >
        <Shape shape={slot.shape} size="0.72em" />
      </span>

      <span className="flex-1 leading-tight break-words">{label}</span>

      <span
        className={cn(
          "answer-letter shrink-0 font-ui font-bold",
          // Full strength, NOT held back. The letter was at opacity .55 so it
          // would not compete with the label, and every contrast audit passed
          // it -- because element opacity is not part of the computed `color`,
          // so the probe was measuring the ink rather than what the eye gets.
          // Composited, it measured 2.85-3.57:1 on the phone and 3.15-4.02:1
          // on the stage, against a 4.5:1 floor.
          //
          // The letter is one of §5's four redundant channels, so it is
          // CONTENT: it is what a colour-blind player reads INSTEAD of the hue.
          // A redundant channel cannot be decorative, and "subordinate to the
          // label" is not worth paying for in the one channel that exists for
          // people the other channels fail.
          //
          // Solved: no opacity clears the stage's 7:1 (slot B caps at 6.47:1
          // even at full strength), and >=0.79 is needed for 4.5:1. At 1.0 the
          // letter simply inherits the slot ladder's own measured ink-on-fill
          // ratios -- 6.47-9.95:1, already audited and already covered by the
          // documented §6 dead-zone exception for slots B and C.
          "opacity-100",
          stage ? "text-[0.6em]" : "text-callout"
        )}
        aria-hidden="true"
      >
        {slot.letter}
      </span>

      {state === "correct" && (
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...spring.pop, delay: 0.06 }}
          className="answer-stamp answer-stamp-correct absolute top-2 right-2 grid place-items-center rounded-pill bg-accent text-accent-ink w-7 h-7 text-subhead font-bold"
          aria-label="correct answer"
        >
          ✓
        </motion.span>
      )}
      {state === "wrong" && (
        <span
          className="answer-stamp answer-stamp-wrong absolute top-2 right-2 grid place-items-center rounded-pill w-7 h-7 text-subhead font-bold opacity-80"
          style={{ background: "var(--incorrect)", color: "var(--ink)" }}
          aria-hidden="true"
        >
          ✕
        </span>
      )}
    </Tag>
  );
}
