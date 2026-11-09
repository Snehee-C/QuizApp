import { useState } from "react";
import { motion } from "motion/react";
import type { EditorProps, PlayerProps, SlideTypeDef, StageProps } from "./types";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { Shape } from "../components/ui/Shape";
import { slotFor } from "../lib/answers";
import { STAGGER_LG, duration, ease, spring } from "../lib/motion";
import { AnsweredEcho, EchoOption, asIndexList } from "./answeredEcho";

// Ranking — players order a list; the room sees the aggregate order.
//
// Colour follows an item's ORIGINAL config index everywhere (player row, stage
// row, preview), never its current position. The hue is an identity channel:
// if it tracked position instead, every reorder would repaint the list and the
// room would lose track of which bar is which.

function RankingEditor({ config, onChange }: EditorProps) {
  const items: string[] = config.items ?? [];
  const [draft, setDraft] = useState<string[] | null>(null);
  const shown = draft ?? items;

  function commit(next: string[]) {
    setDraft(null);
    onChange({ items: next });
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <Label className="mb-0">Items to rank</Label>
        <span className="text-caption text-ink-subtle">Players put these in order</span>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((item, i) => {
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
                value={item}
                aria-label={`Item ${i + 1}`}
                onChange={(e) => {
                  const next = [...shown];
                  next[i] = e.target.value;
                  setDraft(next);
                }}
                onBlur={() => draft && commit(draft)}
              />
              <button
                onClick={() => onChange({ items: items.filter((_, j) => j !== i) })}
                disabled={items.length <= 2}
                aria-label={`Remove item ${i + 1}`}
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
          disabled={items.length >= 6}
          onClick={() => onChange({ items: [...items, `Item ${items.length + 1}`] })}
        >
          + Add item
        </Button>
      </div>
    </div>
  );
}

function RankingPlayer({ slide, onSubmit, disabled, value }: PlayerProps) {
  const items: string[] = slide.config?.items ?? [];
  const [order, setOrder] = useState<number[]>(() => items.map((_, i) => i));

  // Reconnected with an order already banked. Echoing it is worth more here
  // than anywhere else: a ranking is the one answer nobody remembers five
  // minutes later. Hue follows the item's ORIGINAL config index, exactly as it
  // does in the live list and on the stage — the position number is what moved.
  const mine = asIndexList(value)?.filter((i) => i < items.length);
  if (mine?.length) {
    return (
      <AnsweredEcho label="Your ranking">
        <ol className="flex flex-col gap-2">
          {mine.map((item, pos) => (
            <li key={item}>
              <EchoOption
                index={item}
                label={items[item]}
                lead={
                  <span className="nums shrink-0 w-5 text-subhead font-bold text-ink-subtle text-right">
                    {pos + 1}
                  </span>
                }
              />
            </li>
          ))}
        </ol>
      </AnsweredEcho>
    );
  }

  // Up/down rather than drag-and-drop: HTML5 DnD does not fire on touch at
  // all, and pointer-based dragging fights the page scroll on a phone. Two
  // buttons always work, and they are reachable by keyboard and screen reader.
  function move(pos: number, delta: number) {
    const to = pos + delta;
    if (to < 0 || to >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      [next[pos], next[to]] = [next[to], next[pos]];
      return next;
    });
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-footnote text-ink-subtle px-1">Best at the top.</p>

      <ol className="flex flex-col gap-2.5">
        {order.map((item, pos) => {
          const slot = slotFor(item);
          const label = items[item] ?? `Item ${item + 1}`;
          return (
            <motion.li
              key={item}
              layout
              transition={spring.default}
              className="flex items-center gap-3 rounded-lg bg-surface-2 shadow-line pl-3 pr-2 py-2"
            >
              <span className="nums shrink-0 w-5 text-subhead font-bold text-ink-subtle text-right">
                {pos + 1}
              </span>
              <span
                className="shrink-0 grid place-items-center rounded-md w-11 h-11"
                style={{ background: slot.fill, color: slot.ink }}
                aria-hidden="true"
              >
                <Shape shape={slot.shape} size={18} />
              </span>
              <span className="flex-1 text-body font-semibold leading-tight break-words">
                {label}
              </span>
              <div className="shrink-0 flex gap-1.5">
                <MoveButton
                  dir="up"
                  label={`Move ${label} up`}
                  disabled={disabled || pos === 0}
                  onClick={() => move(pos, -1)}
                />
                <MoveButton
                  dir="down"
                  label={`Move ${label} down`}
                  disabled={disabled || pos === order.length - 1}
                  onClick={() => move(pos, 1)}
                />
              </div>
            </motion.li>
          );
        })}
      </ol>

      <Button
        variant="primary"
        size="lg"
        disabled={disabled || order.length === 0}
        onClick={() => onSubmit(order)}
        className="mt-1"
      >
        Submit ranking
      </Button>
    </div>
  );
}

function MoveButton({
  dir,
  label,
  disabled,
  onClick,
}: {
  dir: "up" | "down";
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
      className="press w-11 h-11 grid place-items-center rounded-md bg-surface-3 text-ink text-body font-bold disabled:opacity-30 disabled:pointer-events-none"
    >
      {dir === "up" ? "↑" : "↓"}
    </button>
  );
}

function RankingStage({ slide, aggregate }: StageProps) {
  const items: string[] = aggregate?.items ?? slide.config?.items ?? [];
  const scores: number[] = aggregate?.scores ?? [];
  const order: number[] = aggregate?.order ?? items.map((_, i) => i);
  const total: number = aggregate?.total ?? 0;

  if (!aggregate || total === 0) {
    return (
      <p className="w-full text-center text-stage-name text-ink-subtle">Waiting for responses…</p>
    );
  }

  const max = Math.max(1, ...scores);

  return (
    <div className="w-full flex flex-col gap-stage-gap">
      <p className="text-stage-label font-semibold uppercase track-label text-ink-muted">
        <span className="nums">{total}</span> {total === 1 ? "ranking" : "rankings"}
      </p>

      <div className="flex flex-col gap-3">
        {order.map((item, rank) => {
          const slot = slotFor(item);
          const score = scores[item] ?? 0;
          return (
            <motion.div
              key={item}
              layout
              transition={spring.default}
              className="relative overflow-hidden rounded-xl bg-surface-1 shadow-line"
            >
              {/* Bar grows inside the row, in the item's own hue — the row and
               * its score are one object, not a label beside a chart. */}
              <motion.div
                className="absolute inset-y-0 left-0"
                style={{ background: slot.fill }}
                initial={{ width: "0%" }}
                animate={{ width: `${Math.max((score / max) * 100, 4)}%` }}
                transition={{
                  duration: duration.stage,
                  ease: ease.expoOut,
                  delay: rank * STAGGER_LG,
                }}
              />
              {/* Scrim so the label keeps one contrast ratio whether it sits
               * over the fill or over the empty track. */}
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{ background: "color-mix(in oklch, var(--canvas), transparent 30%)" }}
              />

              <div className="relative flex items-center gap-5 px-7 py-5 text-ink">
                <span className="nums shrink-0 text-stage-answer font-bold opacity-60 min-w-[1.5ch]">
                  {rank + 1}
                </span>
                <span
                  className="shrink-0 grid place-items-center rounded-md w-[1.6em] h-[1.6em] text-stage-answer"
                  style={{ background: slot.fill, color: slot.ink }}
                >
                  <Shape shape={slot.shape} size="0.68em" />
                </span>
                <span className="flex-1 text-stage-answer font-ui font-semibold leading-tight break-words">
                  {items[item] ?? `Item ${item + 1}`}
                </span>
                <span className="nums shrink-0 text-stage-answer font-bold min-w-[3ch] text-right">
                  {score}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function RankingPreview({ config }: { config: any; question: string }) {
  const items: string[] = config.items ?? [];
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => {
        const slot = slotFor(i);
        return (
          <div
            key={i}
            className="flex items-center gap-2.5 rounded-md bg-surface-2 px-2.5 py-2 text-subhead font-semibold"
          >
            <span className="nums w-4 text-footnote text-ink-subtle text-right">{i + 1}</span>
            <span
              className="shrink-0 grid place-items-center rounded-sm w-8 h-8"
              style={{ background: slot.fill, color: slot.ink }}
              aria-hidden="true"
            >
              <Shape shape={slot.shape} size={14} />
            </span>
            <span className="flex-1 leading-tight break-words">{item || `Item ${i + 1}`}</span>
            <span className="shrink-0 text-ink-subtle text-footnote" aria-hidden="true">
              ↑↓
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const ranking: SlideTypeDef = {
  type: "RANKING",
  label: "Ranking",
  hint: "Players order a list; the room sees the aggregate order.",
  group: "interactive",
  interactive: true,
  defaultConfig: () => ({ items: ["Item 1", "Item 2", "Item 3"] }),
  Editor: RankingEditor,
  Player: RankingPlayer,
  echoesValue: true,
  Stage: RankingStage,
  Preview: RankingPreview,
};
