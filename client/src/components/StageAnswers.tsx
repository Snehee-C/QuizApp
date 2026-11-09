import { useLayoutEffect, useRef } from "react";
import { motion } from "motion/react";
import { slotFor } from "../lib/answers";
import { Shape } from "./ui/Shape";
import { STAGGER_LG, spring } from "../lib/motion";
import { cn } from "../lib/cn";

interface StageAnswersProps {
  options: string[];
  /** Per-option vote counts. Omitted while answering is still open. */
  counts?: number[];
  total?: number;
  /** Set only after the reveal — before that, nothing may give the answer away. */
  correctIndices?: number[];
  revealed?: boolean;
}

// The presenter's answer grid.
//
// This is the "morph tile into its own bar" moment (DESIGN.md §5). Rather than
// cross-fading the question out and a separate bar chart in — which breaks
// spatial continuity and is what the whole category does — each tile keeps its
// position and grows a fill bar *inside itself*. The thing the room was looking
// at becomes the thing the room is now looking at.
//
// Counts stay hidden until the reveal: showing a live tally while answering is
// open creates a bandwagon and tells latecomers what to pick.
//
// Note the stage does NOT dim the wrong options the way the phone does. On a
// phone the dimming is personal feedback; on a projector the room still wants
// to read every option's share, and the glow ring plus the check already mark
// the correct one unambiguously.
//
// Sizing. A grid row stretches to its tallest cell, so one long option used to
// drag its row-mate up with it: measured at 1920x1080, option A wrapped to five
// lines at 360px and option B — the single character "B" — was stretched to the
// same 360px while C and D sat at 133px. A 2.71x spread, and a large empty
// coloured block holding one letter. Two things fix that and they only work
// together:
//
//   1. `auto-rows-fr` — every tile is the same height. Four equal blocks is a
//      grid; two tall and two short is an accident.
//   2. the option text is FITTED (below), so that shared height is bounded by a
//      line cap instead of by whatever the longest option happens to be.
//
// Doing (1) alone would have made all four 360px — tidier and twice as dead.
//
// Forced colours (Windows High Contrast). The same defect AnswerTile has, one
// room worse: measured at 1920x1080, all four bar fills came back
// rgb(255,255,255), zero tiles carried any boundary, and the §5 channel count
// fell 4 -> 2 (shape and letter only). A host running High Contrast projects
// that to an audience, none of whom can turn it off. The hooks below —
// `answer-tile` / `answer-tile-stage`, `answer-bar`, `answer-scrim`,
// `answer-chip`, `answer-letter`, `answer-stamp-correct`, `data-state`, and
// the `--slot-fill` / `--slot-ink` pair — exist only so the forced-colours
// block in index.css can re-speak those channels in system colours. They are
// AnswerTile's names on purpose; only the three elements the phone does not
// have (the bar, the scrim, the stage ring weights) are new.
export function StageAnswers({
  options,
  counts,
  total = 0,
  correctIndices,
  revealed = false,
}: StageAnswersProps) {
  const correct = new Set(correctIndices ?? []);
  const gridRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Fit every option label to the same size — the largest at which NONE of them
  // exceeds MAX_LINES. One shared size rather than a per-tile one: four options
  // set at four different sizes would read as four different kinds of thing.
  //
  // The size is measured, not chosen, which is the same mechanism FitText uses
  // for the question. The ladder still sets the ceiling (`text-stage-answer`,
  // read back off the element) and ANSWER_FLOOR — that step's own clamp minimum
  // — sets the bottom, so this never walks off the ladder in either direction
  // and never approaches the 24px stage floor.
  const fitKey = options.join("\u0000");
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const labels = labelRefs.current.slice(0, options.length).filter(Boolean) as HTMLSpanElement[];
    if (!grid || labels.length === 0) return;

    let lastWidth = -1;
    const fit = () => {
      const width = grid.clientWidth;
      // Only width changes the wrap. Re-fitting on a HEIGHT change would be a
      // feedback loop: the fit is what changes the height.
      if (width === lastWidth || width === 0) return;
      lastWidth = width;

      for (const l of labels) l.style.fontSize = "";
      const cs = getComputedStyle(labels[0]);
      const max = parseFloat(cs.fontSize);
      const leading = parseFloat(cs.lineHeight) / max || 1.25;
      if (!(max > ANSWER_FLOOR)) return;

      const overflows = (px: number) => {
        for (const l of labels) l.style.fontSize = `${px}px`;
        return labels.some((l) => Math.round(l.scrollHeight / (px * leading)) > MAX_LINES);
      };

      if (!overflows(max)) {
        for (const l of labels) l.style.fontSize = "";
        return;
      }
      let lo = ANSWER_FLOOR;
      let hi = max;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (overflows(mid)) hi = mid;
        else lo = mid;
      }
      for (const l of labels) l.style.fontSize = `${lo}px`;
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(grid);
    return () => ro.disconnect();
    // `revealed` is a dependency, not an afterthought: the reveal adds a count
    // column and a check to every row, which narrows the label WITHOUT changing
    // the grid's width — so the ResizeObserver never hears about it, and a
    // fitted option silently re-wraps past the line cap and overflows the stage.
  }, [fitKey, options.length, revealed]);

  return (
    <div
      ref={gridRef}
      className={cn(
        // auto-rows-fr: every tile the same height, so a long option cannot
        // leave its row-mate as a dead block.
        "grid auto-rows-fr gap-stage-gap w-full",
        options.length <= 2 ? "grid-cols-1" : "grid-cols-2"
      )}
    >
      {options.map((opt, i) => {
        const slot = slotFor(i);
        const n = counts?.[i] ?? 0;
        const share = total > 0 ? n / total : 0;
        const isCorrect = correct.has(i);

        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 18 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: revealed && isCorrect ? 1.03 : 1,
            }}
            transition={{
              // The correct-answer stamp is one of the three budgeted
              // overshoot moments (DESIGN.md §4).
              ...(revealed && isCorrect ? spring.pop : spring.default),
              delay: i * 0.05,
            }}
            // `answer-tile` is AnswerTile's hook, worn deliberately rather than
            // cloned: this is a different component — a track with a bar
            // growing inside it, not a filled button — but every state the
            // projector needs in forced colours is one index.css already
            // speaks, and a second vocabulary for the same four states is a
            // second spelling (P1). See the stage section of that block.
            //
            // The state enum gains one value the phone has no use for.
            // `revealed` is NOT `wrong`: the stage deliberately does not dim
            // the losing options (above), and `[data-state="wrong"]` carries a
            // dim. Reusing the word would have imported the behaviour.
            className={cn(
              "answer-tile answer-tile-stage relative overflow-hidden rounded-xl",
              revealed && isCorrect && "shadow-glow z-10"
            )}
            data-state={revealed ? (isCorrect ? "correct" : "revealed") : "idle"}
            style={
              {
                background: "var(--surface-1)",
                // Read back only by the forced-colours block, which needs the
                // slot's measured pair after `currentColor` has been forced.
                "--slot-fill": slot.fill,
                "--slot-ink": slot.ink,
              } as React.CSSProperties
            }
          >
            {/* The bar. Grows from the tile's own left edge in the tile's own
             * colour, so the tile and its result are the same object. */}
            <motion.div
              className="answer-bar absolute inset-y-0 left-0"
              style={{ background: slot.fill }}
              initial={{ width: "100%" }}
              animate={{ width: revealed ? `${Math.max(share * 100, 6)}%` : "100%" }}
              transition={{
                duration: 0.52,
                ease: [0.16, 1, 0.3, 1],
                delay: revealed ? 0.42 + i * STAGGER_LG : 0,
              }}
            />

            {revealed && (
              <motion.div
                aria-hidden="true"
                className="answer-scrim absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.42 }}
                style={{
                  background: "color-mix(in oklch, var(--canvas), transparent 30%)",
                }}
              />
            )}

            {/* h-full so a short option sits on the tile's optical centre.
                Equal-height tiles without it leave "C" hanging at the top of
                its own block, which is the lopsidedness one layer down. */}
            <div
              className="relative h-full flex items-center gap-5 px-7 py-6"
              style={{ color: revealed ? "var(--ink)" : slot.ink }}
            >
              <span
                className="answer-chip shrink-0 grid place-items-center rounded-md w-[1.7em] h-[1.7em] text-stage-answer"
                style={{
                  background: revealed
                    ? slot.fill
                    : "color-mix(in oklch, currentColor, transparent 86%)",
                  color: revealed ? slot.ink : "currentColor",
                }}
              >
                <Shape shape={slot.shape} size="0.68em" />
              </span>

              <span
                ref={(el) => {
                  labelRefs.current[i] = el;
                }}
                className="flex-1 text-stage-answer font-ui font-semibold leading-tight break-words"
              >
                {opt}
              </span>

              {/* The letter channel, at full strength — it used to sit at
                * `opacity-60`, which is a de-emphasis the stage cannot afford.
                * An element opacity is not part of the computed `color`, so
                * every contrast audit was reading the author's ink rather than
                * what the room receives. The letter also composites against
                * two different things depending on the beat, which is why one
                * number never described it:
                *
                *   answering open — the bar is 100% wide, so this is the
                *   slot's own ink on the slot's own fill, per slot:
                *     0.60  dark  A 4.02  B 3.15  C 3.39  D 4.00
                *           light A 4.02  B 3.15  C 3.28  D 3.64
                *     1.00  dark  A 9.26  B 6.47  C 6.97  D 9.95
                *           light A 9.26  B 6.47  C 6.46  D 7.98
                *   revealed — the bar has shrunk out from under the letter,
                *   which now sits on --ink over the scrimmed track: one
                *   shared pair, so all four slots measure alike:
                *     0.60  dark 6.74   light 4.49
                *     1.00  dark 17.70  light 16.60
                *
                * Stage Light at 4.49:1 was below even the 4.5:1 player floor,
                * on a 1920px projector, for the channel that exists FOR the
                * people the hue channel already fails — and the open state was
                * worse still, at 3.15. Nothing between 0.60 and 1.00 rescues
                * it: the open state tops out at the ladder's own ink/fill
                * pair, so 0.79 — the lowest alpha clearing 4.5:1 — still
                * leaves the mid slots at about 4.5 and nowhere near the
                * stage's 7:1. Full strength is the only setting that lands the
                * letter inside a bar the system has already documented: at
                * 1.00 it is the SAME pair as the option label beside it, so
                * slots B and C at 6.46-6.97 are exactly the dead-zone
                * exception DESIGN.md §6 records (5.6-7.0:1, AAA-large with
                * margin). 7:1 is unreachable here at any opacity, and that is
                * a property of the §5 ladder, not of this element.
                *
                * `aria-hidden` stays: the option text is what a screen reader
                * should hear, and "C" read aloud before it is noise. */}
              <span
                className="answer-letter nums shrink-0 text-stage-answer font-bold mr-2"
                aria-hidden="true"
              >
                {slot.letter}
              </span>

              {revealed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 + i * STAGGER_LG }}
                  className="nums shrink-0 text-stage-answer font-bold tabular-nums min-w-[2ch] text-right"
                >
                  {n}
                </motion.span>
              )}

              {revealed && isCorrect && (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ ...spring.pop, delay: 0.26 }}
                  className="answer-stamp answer-stamp-correct shrink-0 grid place-items-center rounded-pill bg-accent text-accent-ink w-[1.3em] h-[1.3em] text-stage-answer font-bold"
                  aria-label="correct"
                >
                  ✓
                </motion.span>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// Most lines an option may occupy before the whole set steps down a size. Three
// is what keeps a wrapped option from out-growing the row it shares: at four
// the tile is already taller than two short options stacked.
const MAX_LINES = 3;

// The `stage-answer` step's own clamp minimum (tailwind.config.js). Using the
// ladder step's floor rather than inventing one keeps a fitted label inside the
// same range an unfitted one can occupy — and well clear of the 24px stage
// floor that DESIGN.md §6 audits.
const ANSWER_FLOOR = 26;
