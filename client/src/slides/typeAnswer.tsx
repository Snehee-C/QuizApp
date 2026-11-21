import { useState } from "react";
import { motion } from "motion/react";
import type { EditorProps, PlayerProps, RevealProps, SlideTypeDef, StageProps } from "./types";
import { Button } from "../components/ui/Button";
import { Card, Input, Label } from "../components/ui/Card";
import { ease, spring, STAGGER_LG } from "../lib/motion";
import { cn } from "../lib/cn";
import { insertAt, removeAt } from "../lib/listEdit";
import { TimeLimitField } from "../components/TimeLimitField";

// Quiz: type answer — free text graded against a list of accepted spellings.
//
// SECURITY: `acceptedAnswers` lives only in the presenter's copy of the config.
// The participant socket receives a config with it stripped (see
// server/src/slides/typeAnswer.ts), so neither Player nor Preview may read it —
// only Reveal, which is fed the post-reveal payload.

const MAX_LEN = 120;

/**
 * Must mirror normalize() in server/src/slides/typeAnswer.ts. Used here only
 * to decide what to *highlight* on the stage — the authoritative grade always
 * comes from the server, which is the only side that can be trusted with it.
 */
function normalize(s: string, caseSensitive: boolean): string {
  const collapsed = s.trim().replace(/\s+/g, " ");
  return caseSensitive ? collapsed : collapsed.toLocaleLowerCase();
}

function TAEditor({ config, onChange, onRemove }: EditorProps) {
  const accepted: string[] = Array.isArray(config.acceptedAnswers) ? config.acceptedAnswers : [""];
  // Typing is held locally and committed on blur, so a keystroke doesn't fire
  // a save per character (same pattern as multipleChoice's options list).
  const [draft, setDraft] = useState<string[] | null>(null);
  const shown = draft ?? accepted;

  return (
    <>
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <Label className="mb-0">Accepted answers</Label>
          <span className="text-caption text-ink-subtle">Any one of these scores</span>
        </div>

        <div className="flex flex-col gap-2">
          {shown.map((answer, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={answer}
                maxLength={MAX_LEN}
                placeholder={i === 0 ? "The answer" : "Another spelling…"}
                aria-label={`Accepted answer ${i + 1}`}
                onChange={(e) => {
                  const next = [...shown];
                  next[i] = e.target.value;
                  setDraft(next);
                }}
                onBlur={() => {
                  if (!draft) return;
                  setDraft(null);
                  onChange({ acceptedAnswers: draft });
                }}
              />
              <button
                onClick={() => {
                  setDraft(null);
                  const removed = accepted[i];
                  const list = (c: any): string[] =>
                    Array.isArray(c.acceptedAnswers) ? c.acceptedAnswers : [""];
                  const apply = (c: any) => ({ ...c, acceptedAnswers: removeAt(list(c), i) });
                  const restore = (c: any) => ({
                    ...c,
                    acceptedAnswers: insertAt(list(c), i, removed),
                  });
                  if (onRemove) onRemove({ label: `accepted answer ${i + 1}`, apply, restore });
                  else onChange(apply(config));
                }}
                disabled={accepted.length <= 1}
                aria-label={`Remove accepted answer ${i + 1}`}
                className="shrink-0 w-9 h-9 grid place-items-center rounded-sm text-ink-subtle hover:text-ink disabled:opacity-25 disabled:pointer-events-none transition-colors duration-fast"
              >
                ✕
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-start mt-1"
            disabled={accepted.length >= 10}
            onClick={() => {
              setDraft(null);
              onChange({ acceptedAnswers: [...accepted, ""] });
            }}
          >
            + Add alternative
          </Button>
        </div>

        <p className="text-footnote text-ink-subtle mt-2">
          Leading, trailing and repeated spaces are ignored, so “new&nbsp;&nbsp;york” still
          matches “New York”.
        </p>
      </div>

      <Card level={0} className="px-5 py-4 flex flex-col gap-4">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!config.caseSensitive}
            onChange={(e) => onChange({ caseSensitive: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-[var(--accent)]"
          />
          <span>
            <span className="font-semibold block">Case sensitive</span>
            <span className="text-footnote text-ink-subtle">
              Off by default — phone keyboards capitalise on their own. Turn on for
              symbols or acronyms.
            </span>
          </span>
        </label>

        <TimeLimitField
          id="ta-tl"
          value={config.timeLimitSec}
          onCommit={(timeLimitSec) => onChange({ timeLimitSec })}
        />
      </Card>
    </>
  );
}

function TAPlayer({ onSubmit, disabled }: PlayerProps) {
  const [text, setText] = useState("");
  const valid = text.trim().length > 0;

  return (
    <form
      className="w-full flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || disabled) return;
        onSubmit(text.trim());
      }}
    >
      {/* autoCapitalize/autoCorrect off: the keyboard "helpfully" rewriting a
          proper noun is the difference between a point and no point, and the
          player never sees it happen. */}
      <Input
        className="h-20 text-center text-title1 font-semibold rounded-lg"
        placeholder="Your answer"
        aria-label="Your answer"
        value={text}
        maxLength={MAX_LEN}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" variant="primary" size="lg" disabled={!valid || disabled}>
        Submit answer
      </Button>
    </form>
  );
}

function TAStage({ slide, aggregate, revealed, reveal }: StageProps) {
  const answers: { text: string; count: number }[] = aggregate?.answers ?? [];
  const total: number = aggregate?.total ?? 0;
  const caseSensitive = !!slide.config?.caseSensitive;

  // The key only ever arrives in the reveal payload — the stage never reads it
  // out of slide.config, so a presenter screen mirrored into the room before
  // the reveal cannot give it away either.
  const acceptedList: string[] = revealed ? ((reveal?.acceptedAnswers as string[]) ?? []) : [];
  const acceptedSet = new Set(acceptedList.map((a) => normalize(a, caseSensitive)));

  if (!revealed) {
    // Deliberately only a count. Projecting the answers while the clock runs
    // hands every latecomer the answer, and this type has exactly one.
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3">
        <span className="text-stage-label font-semibold uppercase track-label text-ink-muted">
          Answers in
        </span>
        <span className="nums font-display font-bold text-stage-q text-ink leading-none">
          {total}
        </span>
        {total === 0 && (
          <span className="text-stage-name text-ink-subtle">Waiting for responses…</span>
        )}
      </div>
    );
  }

  // Past ~6 rows nothing on a projector is readable, and the long tail is
  // almost always one-offs.
  const shown = answers.slice(0, 6);
  const max = Math.max(1, ...shown.map((a) => a.count));

  return (
    <div className="w-full h-full flex flex-col justify-center gap-[5vh]">
      <div className="text-center">
        <span className="block text-stage-label font-semibold uppercase track-label text-ink-muted mb-2">
          {acceptedList.length > 1 ? "Accepted answers" : "The answer"}
        </span>
        <motion.span
          className="font-display font-bold text-stage-q text-accent leading-none block"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.52, ease: ease.expoOut }}
        >
          {acceptedList[0] ?? "—"}
        </motion.span>
        {acceptedList.length > 1 && (
          <span className="block text-stage-label text-ink-muted mt-2">
            also accepted: {acceptedList.slice(1).join(" · ")}
          </span>
        )}
      </div>

      {shown.length > 0 && (
        <div className="flex flex-col gap-2 w-full">
          <span className="text-stage-label font-semibold uppercase track-label text-ink-muted">
            What the room typed
          </span>
          {shown.map((a, i) => {
            const isCorrect = acceptedSet.has(normalize(a.text, caseSensitive));
            return (
              <motion.div
                key={a.text}
                className={cn(
                  "relative overflow-hidden rounded-lg px-6 py-3 flex items-center gap-5",
                  // Correct keeps its weight and gains the accent; the rest
                  // desaturate and dim. Never red/green (DESIGN.md §5).
                  isCorrect ? "bg-surface-2 shadow-glow" : "bg-surface-1 shadow-line opacity-55"
                )}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: isCorrect ? 1 : 0.55, y: 0 }}
                transition={{ ...spring.default, delay: i * STAGGER_LG }}
              >
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-lg"
                  style={{
                    background: isCorrect
                      ? "color-mix(in oklch, var(--accent), transparent 80%)"
                      : "var(--surface-3)",
                  }}
                  initial={{ width: "2%" }}
                  animate={{ width: `${Math.max((a.count / max) * 100, 4)}%` }}
                  transition={{ duration: 0.52, ease: ease.expoOut, delay: i * STAGGER_LG }}
                />
                <span
                  className={cn(
                    "relative shrink-0 w-[1.2em] text-stage-answer font-bold",
                    isCorrect ? "text-accent" : "text-ink-subtle"
                  )}
                  aria-hidden="true"
                >
                  {isCorrect ? "✓" : "✕"}
                </span>
                <span className="relative text-stage-answer font-semibold text-ink truncate">
                  {a.text}
                </span>
                <span className="relative nums text-stage-answer font-bold text-ink-muted ml-auto">
                  {a.count}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}

      <p className="text-center text-stage-label text-ink-muted">
        <span className="nums font-bold text-ink">{aggregate?.correctCount ?? 0}</span> of{" "}
        <span className="nums font-bold text-ink">{total}</span> got it
      </p>
    </div>
  );
}

function TAReveal({ reveal, feedback }: RevealProps) {
  const accepted: string[] = (reveal.acceptedAnswers as string[]) ?? [];
  const wasRight = !!feedback?.correct;

  return (
    <Card level={0} className="px-5 py-5 flex flex-col items-center gap-3 text-center">
      <motion.span
        className={cn(
          "w-12 h-12 rounded-pill grid place-items-center text-title2 font-bold",
          wasRight ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink-muted"
        )}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        // The correct-answer stamp — one of the three budgeted uses of visible
        // overshoot (DESIGN.md §4).
        transition={wasRight ? spring.pop : spring.effect}
        aria-hidden="true"
      >
        {wasRight ? "✓" : "✕"}
      </motion.span>

      <span>
        <span className="block text-caption font-semibold uppercase track-label text-ink-subtle mb-1.5">
          {accepted.length > 1 ? "Accepted answers" : "The answer"}
        </span>
        <span
          className={cn(
            "font-display font-bold text-large-title leading-tight",
            wasRight ? "text-accent" : "text-ink"
          )}
        >
          {accepted[0] ?? "—"}
        </span>
        {accepted.length > 1 && (
          <span className="block text-footnote text-ink-subtle mt-1">
            also accepted: {accepted.slice(1).join(" · ")}
          </span>
        )}
      </span>
    </Card>
  );
}

function TAPreview() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-14 rounded-md bg-surface-2 grid place-items-center text-subhead text-ink-subtle">
        Your answer
      </div>
      <div className="h-10 rounded-md bg-accent text-accent-ink grid place-items-center text-subhead font-semibold">
        Submit answer
      </div>
    </div>
  );
}

export const typeAnswer: SlideTypeDef = {
  type: "TYPE_ANSWER",
  label: "Quiz: type answer",
  hint: "Players type the answer; you set what counts as correct.",
  group: "quiz",
  interactive: true,
  questionPlaceholder: "What is… ?",
  defaultConfig: () => ({
    acceptedAnswers: [""],
    caseSensitive: false,
    isQuiz: true,
    timeLimitSec: 20,
  }),
  Editor: TAEditor,
  Player: TAPlayer,
  Stage: TAStage,
  Reveal: TAReveal,
  Preview: TAPreview,
};
