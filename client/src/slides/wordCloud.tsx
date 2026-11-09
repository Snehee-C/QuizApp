import { useState } from "react";
import { motion } from "motion/react";
import type { EditorProps, PlayerProps, SlideTypeDef, StageProps } from "./types";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { spring } from "../lib/motion";
import { AnsweredEcho, asWordList } from "./answeredEcho";

function WCEditor({ config, onChange }: EditorProps) {
  return (
    <div>
      <Label htmlFor="wc-max">Words per person</Label>
      <Input
        id="wc-max"
        type="number"
        min={1}
        max={6}
        className="nums w-28"
        value={config.maxWords ?? 3}
        onChange={(e) => onChange({ maxWords: Number(e.target.value) })}
      />
    </div>
  );
}

function WCPlayer({ slide, onSubmit, disabled, value }: PlayerProps) {
  const maxWords = slide.config?.maxWords ?? 3;
  const [words, setWords] = useState<string[]>(Array(maxWords).fill(""));
  const any = words.some((w) => w.trim());

  // Reconnected with words already banked. The shell can only echo a stored
  // answer that is a bare string, so an array of words would otherwise vanish
  // — and a word cloud is precisely where people want to check they did not
  // send the same word twice. Chips, not inputs: these are sent, not editable.
  const mine = asWordList(value);
  if (mine) {
    return (
      <AnsweredEcho label={mine.length > 1 ? "Words you sent" : "The word you sent"}>
        <div className="flex flex-wrap gap-2">
          {mine.map((w, i) => (
            <span
              key={`${w}-${i}`}
              className="rounded-pill bg-surface-2 px-4 py-2 text-callout font-semibold text-ink break-words"
            >
              {w}
            </span>
          ))}
        </div>
      </AnsweredEcho>
    );
  }

  return (
    <form
      className="w-full flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(words.map((w) => w.trim()).filter(Boolean));
      }}
    >
      {words.map((w, i) => (
        <Input
          key={i}
          className="h-14 text-center text-body font-semibold"
          placeholder={`Word ${i + 1}`}
          value={w}
          maxLength={28}
          aria-label={`Word ${i + 1}`}
          onChange={(e) => {
            const next = [...words];
            next[i] = e.target.value;
            setWords(next);
          }}
        />
      ))}
      <Button type="submit" variant="primary" size="lg" disabled={!any || disabled} className="mt-1">
        Send
      </Button>
    </form>
  );
}

function WCStage({ aggregate }: StageProps) {
  const words: { text: string; count: number }[] = aggregate?.words ?? [];
  if (words.length === 0) {
    return (
      <p className="w-full text-center text-stage-name text-ink-subtle">Waiting for responses…</p>
    );
  }
  const max = Math.max(1, ...words.map((w) => w.count));
  // Only crown a word when there is a single clear leader. Early on every word
  // has one vote, and highlighting all of them paints the whole cloud accent.
  const leaders = words.filter((w) => w.count === max);
  const leader = leaders.length === 1 ? leaders[0].text : null;

  return (
    <div className="w-full h-full flex flex-wrap gap-x-8 gap-y-3 items-center justify-center content-center">
      {words.map((w, i) => (
        <motion.span
          key={w.text}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...spring.default, delay: i * 0.03 }}
          className="font-display font-bold leading-none"
          style={{
            // Floor at the stage minimum so a single-vote word stays readable
            // from the back of the room.
            fontSize: `clamp(28px, ${2.2 + (w.count / max) * 4.6}vw, ${40 + (w.count / max) * 90}px)`,
            color: w.text === leader ? "var(--accent)" : "var(--ink)",
            opacity: leader ? 0.5 + (w.count / max) * 0.5 : 0.92,
          }}
        >
          {w.text}
        </motion.span>
      ))}
    </div>
  );
}

function WCPreview({ config }: { config: any; question: string }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: config.maxWords ?? 3 }, (_, i) => (
        <div key={i} className="h-11 rounded-md bg-surface-2 grid place-items-center text-footnote text-ink-subtle">
          Word {i + 1}
        </div>
      ))}
    </div>
  );
}

export const wordCloud: SlideTypeDef = {
  type: "WORD_CLOUD",
  label: "Word cloud",
  hint: "Short words, sized by how often they're said.",
  group: "interactive",
  interactive: true,
  defaultConfig: () => ({ maxWords: 3 }),
  Editor: WCEditor,
  Player: WCPlayer,
  echoesValue: true,
  Stage: WCStage,
  Preview: WCPreview,
};
