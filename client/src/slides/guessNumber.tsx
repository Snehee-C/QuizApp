import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { EditorProps, PlayerProps, RevealProps, SlideTypeDef, StageProps } from "./types";
import { Button } from "../components/ui/Button";
import { Card, Input, Label } from "../components/ui/Card";
import { ease, spring, STAGGER } from "../lib/motion";
import { cn } from "../lib/cn";
import { AnsweredEcho, asNumber } from "./answeredEcho";

// Guess the number — everyone submits a number, closest to the target wins.
// Always quiz-scored: a "closest guess" round with no scoreboard has no point,
// so unlike multipleChoice there is no quiz-mode toggle to turn off.
//
// SECURITY: `correctValue` and `tolerance` live only in the presenter's copy
// of the config. The participant socket receives a config with both stripped
// (see server/src/slides/guessNumber.ts), so nothing in Player or Preview may
// read them — only Reveal, which is fed the post-reveal payload.

/**
 * The player's own guess, stashed by Player at submit time and read back by
 * Reveal to show the delta. RevealProps carries the graded outcome but not the
 * value that produced it, and widening that contract for one slide type would
 * be worse than a map that never leaves this module. Keyed by slide id, so it
 * is bounded by deck size.
 */
const lastGuess = new Map<string, number>();

/** Numbers here are author-supplied and may be fractional; keep them readable. */
function fmt(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function GNEditor({ config, onChange }: EditorProps) {
  return (
    <>
      <div className="flex gap-5 flex-wrap">
        <div>
          <Label htmlFor="gn-value">Correct value</Label>
          <Input
            id="gn-value"
            type="number"
            className="nums w-36"
            value={config.correctValue ?? 100}
            onChange={(e) => onChange({ correctValue: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor="gn-tol">Tolerance ±</Label>
          <Input
            id="gn-tol"
            type="number"
            min={0}
            className="nums w-32"
            value={config.tolerance ?? 0}
            onChange={(e) => onChange({ tolerance: Math.abs(Number(e.target.value)) })}
          />
        </div>
        <div>
          <Label htmlFor="gn-unit">Unit (optional)</Label>
          <Input
            id="gn-unit"
            className="w-36"
            placeholder="km, %, kg…"
            value={config.unit ?? ""}
            maxLength={12}
            onChange={(e) => onChange({ unit: e.target.value })}
          />
        </div>
      </div>

      <p className="text-footnote text-ink-subtle -mt-2">
        {(config.tolerance ?? 0) > 0
          ? `Anything within ±${config.tolerance} of ${config.correctValue ?? 100} scores.`
          : "Only the exact value scores. Raise the tolerance to accept a range."}
      </p>

      <Card level={0} className="px-5 py-4 flex items-center gap-3">
        <Label className="mb-0" htmlFor="gn-tl">
          Time limit
        </Label>
        <Input
          id="gn-tl"
          type="number"
          min={5}
          max={120}
          className="nums w-24 h-9"
          value={config.timeLimitSec ?? 20}
          onChange={(e) => onChange({ timeLimitSec: Number(e.target.value) })}
        />
        <span className="text-footnote text-ink-subtle">seconds</span>
      </Card>
    </>
  );
}

function GNPlayer({ slide, onSubmit, disabled, value }: PlayerProps) {
  const unit: string = slide.config?.unit ?? "";
  const [raw, setRaw] = useState("");

  const parsed = Number(raw);
  const valid = raw.trim().length > 0 && Number.isFinite(parsed);

  // A reload wipes `lastGuess`, which is what Reveal reads to draw "your guess,
  // off by N". Re-seeding it from the server's copy means a player who
  // reconnects still gets the delta instead of a reveal that shows only the
  // answer — the same information everyone else in the room is getting.
  const stored = asNumber(value);
  useEffect(() => {
    if (stored != null) lastGuess.set(slide.id, stored);
  }, [slide.id, stored]);

  if (stored != null) {
    return (
      <AnsweredEcho label="Your guess">
        <p className="nums font-display text-display font-bold leading-none text-ink">
          {fmt(stored)}
          {unit && <span className="font-ui text-title3 text-ink-muted ml-2">{unit}</span>}
        </p>
      </AnsweredEcho>
    );
  }

  return (
    <form
      className="w-full flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || disabled) return;
        lastGuess.set(slide.id, parsed);
        onSubmit(parsed);
      }}
    >
      <div className="relative flex items-center">
        {/* type="text" + inputMode="decimal": type="number" draws spinners that
            look broken at display size and silently discards a value the
            browser considers mid-edit. We parse it ourselves instead. */}
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="send"
          aria-label="Your guess"
          placeholder="0"
          value={raw}
          maxLength={16}
          onChange={(e) => setRaw(e.target.value.replace(/[^0-9.,-]/g, "").replace(/,/g, ""))}
          className={cn(
            "w-full bg-surface-2 text-ink placeholder:text-ink-subtle nums",
            "rounded-lg h-24 px-5 text-center text-display font-bold shadow-line outline-none",
            "transition-shadow duration-fast ease-standard",
            "focus:shadow-[var(--line),var(--focus)]",
            unit && "pr-20"
          )}
        />
        {unit && (
          <span className="absolute right-5 text-title3 font-semibold text-ink-subtle pointer-events-none">
            {unit}
          </span>
        )}
      </div>

      <Button type="submit" variant="primary" size="lg" disabled={!valid || disabled}>
        Lock in my guess
      </Button>
    </form>
  );
}

/**
 * Anonymous guesses plotted on a shared axis. Before the reveal this is the
 * only thing the room sees — it shows the shape of the room's thinking without
 * naming anyone and, critically, without anchoring on the target.
 */
function NumberLine({
  guesses,
  correct,
  tolerance,
}: {
  guesses: number[];
  /** Set only after the reveal. */
  correct?: number;
  tolerance: number;
}) {
  if (guesses.length === 0) return null;

  const bounds = correct == null ? guesses : [...guesses, correct - tolerance, correct + tolerance];
  const lo = Math.min(...bounds);
  const hi = Math.max(...bounds);
  // One unanimous guess collapses the domain to a point; park everything mid-axis.
  const flat = hi === lo;
  const pos = (v: number) => (flat ? 50 : ((v - lo) / (hi - lo)) * 100);

  return (
    <div className="w-full px-[3vw]">
      <div className="relative h-[13vh] min-h-[96px]">
        <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-pill bg-hairline-strong" />

        {correct != null && tolerance > 0 && !flat && (
          <motion.div
            className="absolute top-1/2 h-[18px] -translate-y-1/2 rounded-pill"
            style={{
              left: `${pos(correct - tolerance)}%`,
              width: `${pos(correct + tolerance) - pos(correct - tolerance)}%`,
              background: "color-mix(in oklch, var(--accent), transparent 78%)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.32 }}
          />
        )}

        {guesses.map((g, i) => {
          // Correct = accent + ring; everything else desaturates. Never
          // red/green (DESIGN.md §5).
          const inBand = correct != null && Math.abs(g - correct) <= tolerance;
          return (
            <motion.span
              key={`${g}-${i}`}
              className={cn(
                "absolute top-1/2 rounded-pill -translate-x-1/2 -translate-y-1/2",
                inBand ? "w-[22px] h-[22px] bg-accent shadow-glow" : "w-[14px] h-[14px] bg-ink-subtle"
              )}
              style={{ left: `${pos(g)}%`, opacity: correct != null && !inBand ? 0.4 : 0.85 }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ ...spring.default, delay: Math.min(i, 20) * STAGGER }}
            />
          );
        })}

        {correct != null && (
          <motion.span
            className="absolute top-[14%] bottom-[14%] w-[5px] -translate-x-1/2 rounded-pill bg-accent"
            style={{ left: `${pos(correct)}%` }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ duration: 0.32, ease: ease.expoOut }}
          />
        )}
      </div>

      {!flat && (
        <div className="flex justify-between nums text-stage-label text-ink-subtle mt-1">
          <span>{fmt(lo)}</span>
          <span>{fmt(hi)}</span>
        </div>
      )}
    </div>
  );
}

function GNStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <p className="text-center">
      <span className="block text-stage-label font-semibold uppercase track-label text-ink-muted mb-1">
        {label}
      </span>
      <span
        className={cn(
          "nums font-display font-bold text-stage-answer leading-none",
          accent ? "text-accent" : "text-ink"
        )}
      >
        {value}
      </span>
    </p>
  );
}

function GNStage({ slide, aggregate, revealed, reveal }: StageProps) {
  const guesses: number[] = aggregate?.guesses ?? [];
  const total: number = aggregate?.total ?? 0;
  const unit: string = slide.config?.unit ?? "";

  // The target only ever arrives in the reveal payload — the stage never reads
  // it out of slide.config, so a presenter screen mirrored into the room
  // before the reveal cannot give it away either.
  const correct = revealed ? (reveal?.correctValue as number | undefined) : undefined;
  const tolerance = revealed ? ((reveal?.tolerance as number | undefined) ?? 0) : 0;

  if (total === 0 && !revealed) {
    return <p className="w-full text-center text-stage-name text-ink-subtle">Waiting for guesses…</p>;
  }

  const within =
    correct == null ? 0 : guesses.filter((g) => Math.abs(g - correct) <= tolerance).length;

  return (
    <div className="w-full h-full flex flex-col justify-center gap-[5vh]">
      {correct != null ? (
        <div className="text-center">
          <span className="block text-stage-label font-semibold uppercase track-label text-ink-muted mb-2">
            The answer
          </span>
          <motion.span
            className="nums font-display font-bold text-stage-q text-accent leading-none inline-flex items-baseline gap-4"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.52, ease: ease.expoOut }}
          >
            {fmt(correct)}
            {unit && <span className="text-stage-answer text-ink-muted font-ui">{unit}</span>}
          </motion.span>
        </div>
      ) : (
        <div className="text-center">
          <span className="block text-stage-label font-semibold uppercase track-label text-ink-muted mb-2">
            Guesses in
          </span>
          <span className="nums font-display font-bold text-stage-q text-ink leading-none">
            {total}
          </span>
        </div>
      )}

      <NumberLine guesses={guesses} correct={correct} tolerance={tolerance} />

      {correct != null && (
        <div className="flex justify-center gap-[6vw]">
          <GNStat
            label="Average guess"
            value={guesses.length ? fmt(aggregate?.average ?? 0) : "—"}
          />
          <GNStat
            label={tolerance > 0 ? `Within ±${fmt(tolerance)}` : "Spot on"}
            value={`${within}`}
            accent={within > 0}
          />
        </div>
      )}
    </div>
  );
}

function GNReveal({ slide, reveal, feedback }: RevealProps) {
  const correct = reveal.correctValue as number | undefined;
  const tolerance = (reveal.tolerance as number | undefined) ?? 0;
  const unit: string = slide.config?.unit ?? "";
  const mine = lastGuess.get(slide.id);
  const wasRight = !!feedback?.correct;

  return (
    <div className="flex flex-col gap-3">
      <Card level={0} className="px-5 py-5 text-center">
        <span className="block text-caption font-semibold uppercase track-label text-ink-subtle mb-1.5">
          The answer
        </span>
        <span className="nums font-display font-bold text-display leading-none text-accent">
          {correct == null ? "—" : fmt(correct)}
          {unit && <span className="font-ui text-title3 text-ink-muted ml-2">{unit}</span>}
        </span>
        {tolerance > 0 && (
          <span className="block nums text-footnote text-ink-subtle mt-1.5">
            anything within ±{fmt(tolerance)} counted
          </span>
        )}
      </Card>

      {mine != null && (
        <Card
          level={0}
          className={cn(
            "px-5 py-4 flex items-center gap-4",
            // Correct = accent + ✓, wrong = dimmed + ✕ (DESIGN.md §5).
            !wasRight && "opacity-55 saturate-50"
          )}
        >
          <motion.span
            className={cn(
              "shrink-0 w-11 h-11 rounded-pill grid place-items-center text-title3 font-bold",
              wasRight ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink-muted"
            )}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            // The correct-answer stamp — one of the three budgeted uses of
            // visible overshoot (DESIGN.md §4).
            transition={wasRight ? spring.pop : spring.effect}
            aria-hidden="true"
          >
            {wasRight ? "✓" : "✕"}
          </motion.span>
          <span className="text-left">
            <span className="block text-caption font-semibold uppercase track-label text-ink-subtle">
              Your guess
            </span>
            <span className="nums text-title2 font-bold text-ink leading-tight">
              {fmt(mine)}
              {unit && <span className="text-subhead text-ink-muted ml-1.5">{unit}</span>}
            </span>
          </span>
          {correct != null && !wasRight && (
            <span className="nums ml-auto text-subhead font-semibold text-ink-muted">
              off by {fmt(Math.abs(mine - correct))}
            </span>
          )}
        </Card>
      )}
    </div>
  );
}

function GNPreview({ config }: { config: any; question: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-16 rounded-md bg-surface-2 grid place-items-center nums text-title2 font-bold text-ink-subtle">
        0{config.unit ? ` ${config.unit}` : ""}
      </div>
      <div className="h-10 rounded-md bg-accent text-accent-ink grid place-items-center text-subhead font-semibold">
        Lock in my guess
      </div>
    </div>
  );
}

export const guessNumber: SlideTypeDef = {
  type: "GUESS_NUMBER",
  label: "Guess the number",
  hint: "Everyone guesses a number — closest wins.",
  group: "quiz",
  interactive: true,
  questionPlaceholder: "How many… ?",
  defaultConfig: () => ({
    correctValue: 100,
    tolerance: 0,
    unit: "",
    isQuiz: true,
    timeLimitSec: 20,
  }),
  Editor: GNEditor,
  Player: GNPlayer,
  echoesValue: true,
  Stage: GNStage,
  Reveal: GNReveal,
  Preview: GNPreview,
};
