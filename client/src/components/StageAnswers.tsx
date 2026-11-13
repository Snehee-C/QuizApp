import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { slotFor } from "../lib/answers";
import { Shape } from "./ui/Shape";
import { REVEAL, STAGGER_LG, ease, prefersReducedMotion, spring } from "../lib/motion";
import { playSound } from "../lib/sound";
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
// ── THE BEAT STRUCTURE, AND WHY IT IS THE OTHER WAY ROUND NOW ───────────
//
// Measured on a live room before this change: `data-state` flipped to
// "correct" at t=70ms, the halo was on at t=70ms, the ✓ was fully landed by
// t=487ms — and the distribution bars did not start moving until t=504ms and
// did not finish until t=1120ms. The answer was given in frame one and the
// remaining second was spent drawing a chart about a question the room had
// already stopped caring about. The choreography was real; it just ran in the
// order that destroys it.
//
// §5 lists the morph last, which is correct as an argument about morphing
// versus cross-fading and wrong as an argument about theatre. There are two
// secrets at a reveal — what everyone picked, and which one was right — and
// the first is much the cheaper. Spending the opening beat on it buys the
// expensive one something it cannot otherwise have: a silence to land in.
//
//   close   300ms  the scrim drops over all four tiles at once. The question
//                  is shut. Nothing is marked.
//   spread  560ms  each tile morphs in place into its own share, 60ms apart,
//                  counts fading in behind them. "Twelve of you said Saturn."
//   hold    300ms  NOTHING, measured from the LAST bar landing. This beat
//                  is the product.
//   answer         the correct tile lifts, haloes, and stamps.
//
// The riser runs under the first three beats and stops dead at `answer`, where
// "land" resolves it. The arming information a muted room needs is the scrim
// and the bars themselves — there is always something visibly in motion right
// up to the hold, and the hold is only 300ms, which is short enough to read as
// a held breath rather than as a stall.
//
// REDUCED MOTION keeps the beats and drops the movement. Nothing here travels
// across the screen — the scrim and the counts are opacity, the bars are a
// width on an element that stays where it is — so the thing reduced motion
// exists to prevent is not present, and suppressing the timing as well would
// delete the moment rather than calm it. What does go: the overshoot on the
// lift and on the ✓ (spring.effect, ζ 1.0, in place of spring.pop) and the
// 1.03 scale itself.
//
// A reveal this instance did not WATCH arrive — a projector reloaded onto an
// already-revealed slide, a host returning to a closed question — runs none of
// it. Delays collapse to zero and no cue fires, for the same reason Present
// restores that state silently: the room has already had this moment and a
// second one would be a lie about what just happened.
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

  const reduced = useRef<boolean | null>(null);
  if (reduced.current === null) reduced.current = prefersReducedMotion();

  // Did this instance mount BEFORE the reveal? Only then does it own the
  // choreography; a grid that mounted already-revealed is a restore.
  const liveRef = useRef<boolean | null>(null);
  if (liveRef.current === null) liveRef.current = !revealed;
  const live = liveRef.current;

  const [phase, setPhase] = useState<Phase>(live ? "idle" : "answer");

  // Scales with the option count: the tiles spread 60ms apart, so the beat the
  // answer lands on has to wait for the LAST of them (see motion.ts).
  const answerAt = REVEAL.answerAt(options.length);

  useEffect(() => {
    if (!revealed || !live) return;
    // One riser spanning close + spread + hold, cut off by "land" on the beat
    // the answer lands. The "reveal" chime Present fires at t=0 is the other
    // half of that sentence: C (the question shuts) → build to G → C.
    playSound("riser", { duration: answerAt / 1000 });
    setPhase("closed");
    const toSpread = window.setTimeout(() => setPhase("spread"), REVEAL.close);
    const toAnswer = window.setTimeout(() => {
      setPhase("answer");
      playSound("land");
    }, answerAt);
    return () => {
      window.clearTimeout(toSpread);
      window.clearTimeout(toAnswer);
    };
  }, [revealed, live, answerAt]);

  // Seconds, collapsed to zero on a restore.
  const beat = (s: number) => (live ? s : 0);
  // The label's ink flips when the bar leaves from under it, not when the
  // reveal fires — before this the two were 420ms apart and the measured
  // pair in the contrast note below described only the later half of it.
  const bare = phase === "spread" || phase === "answer";
  const answerShown = phase === "answer";

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
    //
    // `phase` for the same reason, one beat later: the ✓ is no longer part of
    // the same frame as the count column, so the refit the count triggers
    // happens 860ms before the check arrives and takes up its own width.
  }, [fitKey, options.length, revealed, phase]);

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
              scale: answerShown && isCorrect && !reduced.current ? 1.03 : 1,
            }}
            transition={{
              opacity: { duration: 0.28, delay: i * 0.05 },
              y: { ...spring.default, delay: i * 0.05 },
              // The correct-answer stamp is one of the three budgeted
              // overshoot moments (DESIGN.md §4). It gets its own transition
              // rather than sharing the entrance's: the entrance carried a
              // `delay: i * 0.05` that was silently being applied to the lift
              // as well, so the answer landed up to 150ms late depending on
              // which slot happened to be correct.
              scale: reduced.current ? spring.effect : spring.pop,
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
              answerShown && isCorrect && "shadow-glow z-10"
            )}
            // `correct` is withheld until the answer beat — it is the state
            // forced-colours reads to draw the only marking a High Contrast
            // room gets, so flipping it early would hand the answer to those
            // users 1160ms before everyone else.
            data-state={
              phase === "idle" ? "idle" : answerShown && isCorrect ? "correct" : "revealed"
            }
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
              animate={{ width: bare ? `${Math.max(share * 100, 6)}%` : "100%" }}
              transition={{
                duration: beat(REVEAL.spread / 1000),
                ease: ease.expoOut,
                delay: beat(i * STAGGER_LG),
              }}
            />

            {revealed && (
              <motion.div
                aria-hidden="true"
                className="answer-scrim absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                // The close beat, and all four together: the room is being
                // told the question is shut, which is one event, not four.
                transition={{ duration: beat(REVEAL.close / 1000) }}
                style={{
                  background: "color-mix(in oklch, var(--canvas), transparent 30%)",
                }}
              />
            )}

            {/* h-full so a short option sits on the tile's optical centre.
                Equal-height tiles without it leave "C" hanging at the top of
                its own block, which is the lopsidedness one layer down. */}
            {/* The tile's padding and gutter are `em`, not px. They were
              * 28/24/20px fixed, which is right at the design size and wrong
              * everywhere else: on a 4K stage the type beside them doubles and
              * a tile that is mostly padding at 1366 becomes a tile that is
              * barely any at 2160. In `em` the tile is one shape at every
              * resolution, and at 1920x1080 the three values compute to
              * 27.95 / 23.96 / 19.97px against the 28 / 24 / 20 they replace —
              * the same tile, to a third of a pixel. */}
            <div
              className="relative h-full flex items-center gap-[0.4em] px-[0.56em] py-[0.48em] text-stage-answer"
              style={{ color: bare ? "var(--ink)" : slot.ink }}
            >
              <span
                className="answer-chip shrink-0 grid place-items-center rounded-md w-[1.7em] h-[1.7em] text-stage-answer"
                style={{
                  background: bare
                    ? slot.fill
                    : "color-mix(in oklch, currentColor, transparent 86%)",
                  color: bare ? slot.ink : "currentColor",
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
                  data-tile-count
                  initial={{ opacity: 0 }}
                  animate={{ opacity: bare ? 1 : 0 }}
                  transition={{ duration: beat(0.26), delay: beat(0.12 + i * STAGGER_LG) }}
                  className="nums shrink-0 text-stage-answer font-bold tabular-nums min-w-[2ch] text-right"
                >
                  {n}
                </motion.span>
              )}

              {answerShown && isCorrect && (
                <motion.span
                  initial={{ scale: reduced.current ? 1 : 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  // Budgeted overshoot moment 1 of 3 (DESIGN.md §4). The ✓
                  // trails the lift rather than sharing its frame — a stamp
                  // that lands with the thing it is stamping reads as one
                  // blur, not as two events.
                  transition={{
                    ...(reduced.current ? spring.effect : spring.pop),
                    delay: beat(REVEAL.stamp / 1000),
                  }}
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

/**
 * idle   — answering is open, nothing is marked
 * closed — the scrim is arriving; the question is shut
 * spread — tiles are morphing into their own shares
 * answer — the correct tile has lifted
 */
type Phase = "idle" | "closed" | "spread" | "answer";

// Most lines an option may occupy before the whole set steps down a size. Three
// is what keeps a wrapped option from out-growing the row it shares: at four
// the tile is already taller than two short options stacked.
const MAX_LINES = 3;

// The `stage-answer` step's own clamp minimum (tailwind.config.js). Using the
// ladder step's floor rather than inventing one keeps a fitted label inside the
// same range an unfitted one can occupy — and well clear of the 24px stage
// floor that DESIGN.md §6 audits.
const ANSWER_FLOOR = 26;
