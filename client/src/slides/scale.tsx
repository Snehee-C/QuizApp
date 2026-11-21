import { motion } from "motion/react";
import type { EditorProps, PlayerProps, SlideTypeDef, StageProps } from "./types";
import { Input, Label } from "../components/ui/Card";
import { slotFor } from "../lib/answers";
import { STAGGER_LG, spring } from "../lib/motion";
import { AnsweredEcho, asNumber } from "./answeredEcho";
import { cn } from "../lib/cn";

function ScaleEditor({ config, onChange }: EditorProps) {
  return (
    <div className="flex gap-5">
      <div>
        <Label htmlFor="s-min">Lowest</Label>
        <Input
          id="s-min"
          type="number"
          className="nums w-28"
          value={config.scaleMin ?? 1}
          onChange={(e) => onChange({ scaleMin: Number(e.target.value) })}
        />
      </div>
      <div>
        <Label htmlFor="s-max">Highest</Label>
        <Input
          id="s-max"
          type="number"
          className="nums w-28"
          value={config.scaleMax ?? 5}
          onChange={(e) => onChange({ scaleMax: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}

/**
 * Column count from the range size, so the grid is never ragged by accident.
 * `grid-cols-5` was hard-coded, which rendered a 1–7 scale as 5 + 2 and a 1–3
 * scale as three squares and two holes. Literal class names, because Tailwind
 * only emits what it can read.
 *
 *   ≤5  → one row
 *   6–7 → four across (4+2, 4+3)
 *   8–10 → five across (two rows, 5+3 at worst)
 *   11+ → six across (0–10 is 6+5)
 *
 * Every square stays ≥44px on a 320px phone: six across at 320 − 32 px of
 * padding is 48px minus gaps.
 */
function colsFor(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-2";
  if (n === 3) return "grid-cols-3";
  if (n === 4) return "grid-cols-4";
  if (n === 5) return "grid-cols-5";
  if (n <= 7) return "grid-cols-4";
  if (n <= 10) return "grid-cols-5";
  return "grid-cols-6";
}

function ScalePlayer({ slide, onSubmit, disabled, value }: PlayerProps) {
  const min = slide.config?.scaleMin ?? 1;
  const max = slide.config?.scaleMax ?? 5;
  const nums = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);

  // Reconnected with a rating already banked. A bare number is meaningless
  // without its scale — "4" is excellent out of 5 and poor out of 10 — so the
  // range travels with it. Rendered in the same square the button used, at the
  // same ladder step, so it reads as the tapped button frozen rather than as a
  // different widget.
  const mine = asNumber(value);
  if (mine != null) {
    return (
      <AnsweredEcho label="Your rating">
        <div className="flex items-center gap-4">
          <span className="shrink-0 grid place-items-center w-20 h-20 rounded-lg bg-surface-2 nums text-large-title font-bold text-ink">
            {mine}
          </span>
          <span className="text-subhead text-ink-muted">
            on a scale of <span className="nums font-semibold text-ink">{min}</span> to{" "}
            <span className="nums font-semibold text-ink">{max}</span>
          </span>
        </div>
      </AnsweredEcho>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex justify-between text-caption font-semibold uppercase track-label text-ink-subtle px-1">
        <span>{min} · lowest</span>
        <span>{max} · highest</span>
      </div>
      <div className={cn("grid gap-2.5", colsFor(nums.length))}>
        {nums.map((n, i) => (
          <motion.button
            key={n}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.035, ...spring.default }}
            disabled={disabled}
            onClick={() => onSubmit(n)}
            className="press aspect-square rounded-lg bg-surface-2 text-ink nums text-title2 font-bold grid place-items-center disabled:opacity-40"
          >
            {n}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function ScaleStage({ aggregate }: StageProps) {
  if (!aggregate) {
    return <p className="w-full text-center text-stage-name text-ink-subtle">Waiting for responses…</p>;
  }
  const dist: Record<string, number> = aggregate.distribution ?? {};
  const bars = Object.entries(dist);
  const max = Math.max(1, ...bars.map(([, v]) => v));

  return (
    <div className="w-full h-full flex flex-col justify-center gap-8">
      <p className="text-center">
        <span className="block text-stage-label font-semibold uppercase track-label text-ink-muted mb-1">
          Average
        </span>
        <span className="nums font-display font-bold text-stage-q text-accent leading-none">
          {(aggregate.average ?? 0).toFixed(1)}
        </span>
      </p>
      <div className="flex items-end justify-center gap-stage-gap h-[36%] min-h-[120px]">
        {bars.map(([k, v], i) => (
          <div key={k} className="flex-1 max-w-[9rem] h-full flex flex-col items-center gap-3">
            <div className="flex-1 w-full flex items-end">
              <motion.div
                className="w-full rounded-md"
                style={{ background: slotFor(i).fill }}
                initial={{ height: "2%" }}
                animate={{ height: `${Math.max((v / max) * 100, 3)}%` }}
                transition={{ duration: 0.52, ease: [0.16, 1, 0.3, 1], delay: i * STAGGER_LG }}
              />
            </div>
            <span className="nums text-stage-label font-bold text-ink">{k}</span>
            <span className="nums text-stage-label text-ink-muted">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScalePreview({ config }: { config: any; question: string }) {
  const min = config.scaleMin ?? 1;
  const max = config.scaleMax ?? 5;
  const count = Math.max(0, max - min + 1);
  return (
    <div className={cn("grid gap-2", colsFor(count))}>
      {Array.from({ length: count }, (_, i) => min + i).map((n) => (
        <span key={n} className="nums aspect-square rounded-md bg-surface-2 grid place-items-center text-subhead font-bold">
          {n}
        </span>
      ))}
    </div>
  );
}

export const scale: SlideTypeDef = {
  type: "SCALE",
  label: "Scale / rating",
  hint: "A numeric rating, shown as an average.",
  group: "interactive",
  interactive: true,
  defaultConfig: () => ({ scaleMin: 1, scaleMax: 5 }),
  Editor: ScaleEditor,
  Player: ScalePlayer,
  echoesValue: true,
  Stage: ScaleStage,
  Preview: ScalePreview,
};
