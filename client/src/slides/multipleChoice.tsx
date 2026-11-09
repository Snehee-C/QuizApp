import { useState } from "react";
import type { EditorProps, PlayerProps, RevealProps, SlideTypeDef, StageProps } from "./types";
import { AnswerTile } from "../components/ui/AnswerTile";
import { StageAnswers } from "../components/StageAnswers";
import { Button } from "../components/ui/Button";
import { Input, Card, Label } from "../components/ui/Card";
import { Shape } from "../components/ui/Shape";
import { slotFor } from "../lib/answers";
import { cn } from "../lib/cn";
import { AnsweredEcho, EchoOption, asIndexList } from "./answeredEcho";

// Multiple choice — also serves as "Quiz: select answer" when config.isQuiz is
// on, which is how Mentimeter models it too.

function MCEditor({ config, onChange, onReplace }: EditorProps) {
  const options: string[] = config.options ?? [];
  const correct: number[] = Array.isArray(config.correctIndices) ? config.correctIndices : [];
  const [draft, setDraft] = useState<string[] | null>(null);
  const shown = draft ?? options;

  function commit(next: string[]) {
    setDraft(null);
    onChange({ options: next });
  }

  function removeOption(i: number) {
    const next = options.filter((_, j) => j !== i);
    // Dropping an option must also drop it from the answer key and shift every
    // index above it down, or the key silently points at the wrong option.
    const nextCorrect = correct.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
    onChange({ options: next, correctIndices: nextCorrect });
  }

  return (
    <>
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <Label className="mb-0">Options</Label>
          {config.isQuiz && (
            <span className="text-caption text-ink-subtle">Tick the correct answer(s)</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {shown.map((opt, i) => {
            const slot = slotFor(i);
            const isCorrect = correct.includes(i);
            return (
              <div key={i} className="flex gap-2 items-center">
                <span
                  className="shrink-0 grid place-items-center rounded-sm w-9 h-9"
                  style={{ background: slot.fill, color: slot.ink }}
                  aria-hidden="true"
                >
                  <Shape shape={slot.shape} size={15} />
                </span>
                {config.isQuiz && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isCorrect}
                    aria-label={`Mark option ${slot.letter} correct`}
                    onClick={() =>
                      onChange({
                        correctIndices: isCorrect
                          ? correct.filter((x) => x !== i)
                          : [...correct, i].sort((a, b) => a - b),
                      })
                    }
                    className={cn(
                      "shrink-0 w-9 h-9 grid place-items-center rounded-sm text-subhead font-bold transition-colors duration-fast",
                      isCorrect ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-subtle hover:text-ink"
                    )}
                  >
                    ✓
                  </button>
                )}
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
                  onClick={() => removeOption(i)}
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

      <Card level={0} className="px-5 py-4 flex flex-col gap-4">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!config.isQuiz}
            onChange={(e) => {
              const next: any = { ...config, isQuiz: e.target.checked };
              if (next.isQuiz && correct.length === 0) next.correctIndices = [0];
              if (next.isQuiz && !next.timeLimitSec) next.timeLimitSec = 20;
              onReplace(next);
            }}
            className="mt-0.5 w-4 h-4 accent-[var(--accent)]"
          />
          <span>
            <span className="font-semibold block">Quiz mode</span>
            <span className="text-footnote text-ink-subtle">
              Scores by correctness and speed, with a live leaderboard.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!config.allowMultiple}
            onChange={(e) => onChange({ allowMultiple: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-[var(--accent)]"
          />
          <span>
            <span className="font-semibold block">Allow multiple answers</span>
            <span className="text-footnote text-ink-subtle">
              Players can pick more than one option.
            </span>
          </span>
        </label>

        {config.isQuiz && (
          <div className="flex items-center gap-3">
            <Label className="mb-0" htmlFor="mc-tl">
              Time limit
            </Label>
            <Input
              id="mc-tl"
              type="number"
              min={5}
              max={120}
              className="nums w-24 h-9"
              value={config.timeLimitSec ?? 20}
              onChange={(e) => onChange({ timeLimitSec: Number(e.target.value) })}
            />
            <span className="text-footnote text-ink-subtle">seconds</span>
          </div>
        )}
      </Card>
    </>
  );
}

function MCPlayer({ slide, onSubmit, disabled, value }: PlayerProps) {
  const options: string[] = slide.config?.options ?? [];
  const allowMultiple = !!slide.config?.allowMultiple;
  const [picked, setPicked] = useState<number[]>([]);

  // Reconnected with an answer already banked: show which option(s) went, not
  // a board of live tiles. Indices are filtered against the CURRENT options —
  // a deck edited between sessions can leave a stored index pointing past the
  // end, and a row reading "undefined" is worse than the shell's plain lock.
  const mine = asIndexList(value)?.filter((i) => i < options.length);
  if (mine?.length) {
    return (
      <AnsweredEcho label={mine.length > 1 ? "Your answers" : "Your answer"}>
        {mine.map((i) => (
          <EchoOption key={i} index={i} label={options[i]} />
        ))}
      </AnsweredEcho>
    );
  }

  if (!allowMultiple) {
    return (
      <div className="flex flex-col gap-3 w-full h-full justify-center">
        {options.map((opt, i) => (
          <AnswerTile
            key={i}
            index={i}
            label={opt}
            disabled={disabled}
            onClick={() => onSubmit(i)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full h-full justify-center">
      {options.map((opt, i) => (
        <AnswerTile
          key={i}
          index={i}
          label={opt}
          state={picked.includes(i) ? "chosen" : "idle"}
          disabled={disabled}
          onClick={() =>
            setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))
          }
        />
      ))}
      <Button
        variant="primary"
        size="lg"
        disabled={picked.length === 0 || disabled}
        onClick={() => onSubmit([...picked].sort((a, b) => a - b))}
      >
        Submit {picked.length > 0 && `(${picked.length})`}
      </Button>
    </div>
  );
}

function MCStage({ slide, aggregate, revealed, reveal }: StageProps) {
  return (
    <StageAnswers
      options={slide.config?.options ?? []}
      counts={aggregate?.counts}
      total={aggregate?.total ?? 0}
      correctIndices={revealed ? (reveal?.correctIndices as number[] | undefined) : undefined}
      revealed={revealed}
    />
  );
}

function MCReveal({ slide, reveal }: RevealProps) {
  const options: string[] = slide.config?.options ?? [];
  const correctSet = new Set<number>((reveal.correctIndices as number[]) ?? []);
  return (
    <div className="flex flex-col gap-3">
      {options.map((opt, i) => (
        <AnswerTile
          key={i}
          index={i}
          label={opt}
          state={correctSet.has(i) ? "correct" : "wrong"}
        />
      ))}
    </div>
  );
}

function MCPreview({ config }: { config: any; question: string }) {
  const options: string[] = config.options ?? [];
  return (
    <div className="flex flex-col gap-2">
      {options.map((opt, i) => (
        <AnswerTile
          key={i}
          index={i}
          label={opt || `Option ${i + 1}`}
          className="!min-h-[56px] !py-3 !text-subhead !max-h-none !flex-none"
        />
      ))}
    </div>
  );
}

export const multipleChoice: SlideTypeDef = {
  type: "MULTIPLE_CHOICE",
  label: "Multiple choice",
  hint: "Pick-one options. Turn on quiz mode to score them.",
  group: "interactive",
  interactive: true,
  defaultConfig: () => ({
    options: ["Option 1", "Option 2"],
    isQuiz: false,
    allowMultiple: false,
    correctIndices: [0],
    timeLimitSec: 20,
  }),
  Editor: MCEditor,
  Player: MCPlayer,
  echoesValue: true,
  Stage: MCStage,
  Reveal: MCReveal,
  Preview: MCPreview,
};
