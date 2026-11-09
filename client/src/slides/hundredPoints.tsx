import { useState } from "react";
import { motion } from "motion/react";
import type { EditorProps, PlayerProps, SlideTypeDef, StageProps } from "./types";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { Shape } from "../components/ui/Shape";
import { slotFor } from "../lib/answers";
import { STAGGER_LG, duration, ease, spring } from "../lib/motion";
import { AnsweredEcho, EchoOption, asNumberList } from "./answeredEcho";

// 100 points — players split a fixed budget across the options. Forcing the
// budget to balance is the whole point of the format: it makes people trade
// options off against each other instead of rating each one highly.

/** Button granularity. The slider still moves one point at a time, so an
 *  odd remainder is always reachable even on a non-round budget. */
const STEP = 5;

function HPEditor({ config, onChange }: EditorProps) {
  const options: string[] = config.options ?? [];
  const [draft, setDraft] = useState<string[] | null>(null);
  const shown = draft ?? options;

  function commit(next: string[]) {
    setDraft(null);
    onChange({ options: next });
  }

  return (
    <>
      <div>
        <Label className="mb-2">Options</Label>
        <div className="flex flex-col gap-2">
          {shown.map((opt, i) => {
            const slot = slotFor(i);
            return (
              <div key={i} className="flex gap-2 items-center">
                <span
                  className="shrink-0 grid place-items-center rounded-sm w-9 h-9"
                  style={{ background: slot.fill, color: slot.ink }}
                  aria-hidden="true"
                >
                  <Shape shape={slot.shape} size={15} />
                </span>
                <Input
                  value={opt}
                  aria-label={`Option ${slot.letter}`}
                  onChange={(e) => {
                    const next = [...shown];
                    next[i] = e.target.value;
                    setDraft(next);
                  }}
                  onBlur={() => draft && commit(draft)}
                />
                <button
                  onClick={() => onChange({ options: options.filter((_, j) => j !== i) })}
                  disabled={options.length <= 2}
                  aria-label={`Remove option ${slot.letter}`}
                  className="shrink-0 w-9 h-9 grid place-items-center rounded-sm text-ink-subtle hover:text-ink disabled:opacity-25 disabled:pointer-events-none transition-colors duration-fast"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            className="self-start mt-1"
            disabled={options.length >= 6}
            onClick={() => onChange({ options: [...options, `Option ${options.length + 1}`] })}
          >
            + Add option
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Label className="mb-0" htmlFor="hp-total">
          Points to spend
        </Label>
        <Input
          id="hp-total"
          type="number"
          min={10}
          max={1000}
          step={10}
          className="nums w-28 h-9"
          value={config.total ?? 100}
          onChange={(e) => onChange({ total: Number(e.target.value) })}
        />
      </div>
    </>
  );
}

function HPPlayer({ slide, onSubmit, disabled, value }: PlayerProps) {
  const options: string[] = slide.config?.options ?? [];
  const budget: number = slide.config?.total ?? 100;
  const [points, setPoints] = useState<number[]>(() => options.map(() => 0));

  // Reconnected with an allocation already banked. Only the options that got
  // points are listed: a spend of 0 is not a choice the player made, it is the
  // absence of one, and a row of zeroes reads like a scorecard of failures.
  // Config order is kept rather than sorting by size — the hue channel is tied
  // to the option's index, so resorting would repaint the list.
  const mine = asNumberList(value);
  if (mine) {
    const spent = mine.map((n, i) => [i, n] as const).filter(([i, n]) => n > 0 && i < options.length);
    if (spent.length) {
      return (
        <AnsweredEcho label="How you split your points">
          {spent.map(([i, n]) => (
            <EchoOption
              key={i}
              index={i}
              label={options[i]}
              trail={<span className="nums shrink-0 text-title3 font-bold text-ink">{n}</span>}
            />
          ))}
          <p className="text-footnote text-ink-subtle px-1">
            <span className="nums font-semibold">
              {spent.reduce((a, [, n]) => a + n, 0)}
            </span>{" "}
            of <span className="nums font-semibold">{budget}</span> points placed
          </p>
        </AnsweredEcho>
      );
    }
  }

  const spent = points.reduce((a, b) => a + b, 0);
  const remaining = budget - spent;
  const balanced = remaining === 0;

  function set(i: number, next: number) {
    setPoints((prev) => {
      // Clamp against what is actually left, so the budget can never be
      // overspent — the player only ever has to find the last few points.
      const cap = prev[i] + (budget - prev.reduce((a, b) => a + b, 0));
      const out = [...prev];
      out[i] = Math.max(0, Math.min(next, cap));
      return out;
    });
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-baseline justify-between rounded-lg bg-surface-1 shadow-line px-4 py-3">
        <motion.span
          key={remaining}
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={spring.fast}
          className="nums text-large-title font-bold leading-none"
          style={{ color: balanced ? "var(--accent)" : "var(--ink)" }}
        >
          {remaining}
        </motion.span>
        <span className="text-subhead text-ink-muted">
          of <span className="nums font-semibold">{budget}</span> remaining
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {options.map((opt, i) => {
          const slot = slotFor(i);
          const v = points[i] ?? 0;
          return (
            <div
              key={i}
              className="rounded-lg bg-surface-2 shadow-line px-3 py-3 flex flex-col gap-2.5"
            >
              <div className="flex items-center gap-3">
                <span
                  className="shrink-0 grid place-items-center rounded-md w-9 h-9"
                  style={{ background: slot.fill, color: slot.ink }}
                  aria-hidden="true"
                >
                  <Shape shape={slot.shape} size={16} />
                </span>
                <span className="flex-1 text-callout font-semibold leading-tight break-words">
                  {opt}
                </span>
                <span className="nums text-title2 font-bold">{v}</span>
              </div>

              <div className="flex items-center gap-3">
                <StepButton
                  sign="−"
                  label={`Remove ${STEP} points from ${opt}`}
                  disabled={disabled || v === 0}
                  onClick={() => set(i, v - STEP)}
                />
                <input
                  type="range"
                  min={0}
                  max={v + Math.max(0, remaining)}
                  step={1}
                  value={v}
                  disabled={disabled}
                  aria-label={`Points for ${opt}`}
                  onChange={(e) => set(i, Number(e.target.value))}
                  // The slider takes the option's own hue, not the accent —
                  // lime is reserved for voltage (DESIGN.md P2).
                  style={{ accentColor: slot.fill }}
                  className="flex-1 h-11 cursor-pointer disabled:opacity-40"
                />
                <StepButton
                  sign="+"
                  label={`Add ${STEP} points to ${opt}`}
                  disabled={disabled || remaining === 0}
                  onClick={() => set(i, v + STEP)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <Button
        variant="primary"
        size="lg"
        disabled={disabled || !balanced}
        onClick={() => onSubmit(points)}
        className="mt-1"
      >
        {balanced ? "Submit" : `Spend all ${budget} points`}
      </Button>
    </div>
  );
}

function StepButton({
  sign,
  label,
  disabled,
  onClick,
}: {
  sign: "−" | "+";
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press shrink-0 w-11 h-11 grid place-items-center rounded-md bg-surface-3 text-ink text-title3 font-bold disabled:opacity-30 disabled:pointer-events-none"
    >
      {sign}
    </button>
  );
}

function HPStage({ slide, aggregate }: StageProps) {
  const options: string[] = aggregate?.options ?? slide.config?.options ?? [];
  const totals: number[] = aggregate?.totals ?? [];
  const averages: number[] = aggregate?.averages ?? [];
  const total: number = aggregate?.total ?? 0;

  if (!aggregate || total === 0) {
    return (
      <p className="w-full text-center text-stage-name text-ink-subtle">Waiting for responses…</p>
    );
  }

  const grand = Math.max(1, totals.reduce((a, b) => a + b, 0));

  return (
    <div className="w-full flex flex-col gap-stage-gap">
      <div className="flex items-baseline justify-between text-stage-label font-semibold uppercase track-label text-ink-muted">
        <span>
          <span className="nums">{total}</span> {total === 1 ? "response" : "responses"}
        </span>
        <span>Avg points</span>
      </div>

      <div className="flex flex-col gap-4">
        {options.map((opt, i) => {
          const slot = slotFor(i);
          const share = (totals[i] ?? 0) / grand;
          return (
            <div key={i} className="flex items-center gap-stage-gap">
              <span
                className="shrink-0 grid place-items-center rounded-md w-[1.6em] h-[1.6em] text-stage-answer"
                style={{ background: slot.fill, color: slot.ink }}
              >
                <Shape shape={slot.shape} size="0.68em" />
              </span>

              <span className="w-[24%] shrink-0 text-stage-answer font-ui font-semibold text-ink leading-tight break-words">
                {opt}
              </span>

              <div className="flex-1 h-[1.9em] rounded-md bg-surface-1 shadow-line overflow-hidden text-stage-answer">
                <motion.div
                  className="h-full rounded-md"
                  style={{ background: slot.fill }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${Math.max(share * 100, 1.5)}%` }}
                  transition={{
                    duration: duration.stage,
                    ease: ease.expoOut,
                    delay: i * STAGGER_LG,
                  }}
                />
              </div>

              <span className="nums shrink-0 text-stage-answer font-bold text-ink min-w-[4ch] text-right">
                {(averages[i] ?? 0).toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HPPreview({ config }: { config: any; question: string }) {
  const options: string[] = config.options ?? [];
  const budget: number = config.total ?? 100;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between rounded-md bg-surface-1 px-3 py-2">
        <span className="nums text-title2 font-bold leading-none">{budget}</span>
        <span className="text-caption text-ink-muted">remaining</span>
      </div>
      {options.map((opt, i) => {
        const slot = slotFor(i);
        return (
          <div
            key={i}
            className="flex items-center gap-2.5 rounded-md bg-surface-2 px-2.5 py-2 text-subhead font-semibold"
          >
            <span
              className="shrink-0 grid place-items-center rounded-sm w-8 h-8"
              style={{ background: slot.fill, color: slot.ink }}
              aria-hidden="true"
            >
              <Shape shape={slot.shape} size={14} />
            </span>
            <span className="flex-1 leading-tight break-words">{opt || `Option ${i + 1}`}</span>
            <span className="nums text-ink-subtle">0</span>
          </div>
        );
      })}
    </div>
  );
}

export const hundredPoints: SlideTypeDef = {
  type: "HUNDRED_POINTS",
  label: "100 points",
  hint: "Players split a fixed budget across the options.",
  group: "interactive",
  interactive: true,
  defaultConfig: () => ({ options: ["Option 1", "Option 2"], total: 100 }),
  Editor: HPEditor,
  Player: HPPlayer,
  echoesValue: true,
  Stage: HPStage,
  Preview: HPPreview,
};
