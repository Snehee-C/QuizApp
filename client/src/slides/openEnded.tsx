import { useState } from "react";
import { motion } from "motion/react";
import type { EditorProps, PlayerProps, SlideTypeDef, StageProps } from "./types";
import { Button } from "../components/ui/Button";
import { slotFor } from "../lib/answers";
import { spring } from "../lib/motion";

function OEEditor(_: EditorProps) {
  return (
    <p className="text-subhead text-ink-subtle">
      Players get a text box; their answers appear on the big screen as a feed.
    </p>
  );
}

/** Server-enforced too — mirrored so the counter is honest. */
const MAX_LEN = 500;

function OEPlayer({ onSubmit, disabled }: PlayerProps) {
  const [text, setText] = useState("");
  // The same "{n} left" the Q&A composer shows at 280: one spelling of one
  // decision (DESIGN.md P1). A 500-character box with no counter was the
  // other spelling.
  const remaining = MAX_LEN - text.length;
  return (
    <form
      className="w-full flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
    >
      <textarea
        className="w-full bg-surface-2 text-ink placeholder:text-ink-subtle rounded-md px-4 py-3.5 min-h-[128px] text-body shadow-line outline-none focus:shadow-[var(--line),var(--focus)] transition-shadow duration-fast resize-none"
        placeholder="Type your answer…"
        value={text}
        maxLength={MAX_LEN}
        aria-label="Your answer"
        onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="nums text-footnote text-ink-subtle" aria-live="polite">
          {remaining} left
        </span>
        <Button type="submit" variant="primary" size="lg" disabled={!text.trim() || disabled}>
          Send
        </Button>
      </div>
    </form>
  );
}

function OEStage({ aggregate }: StageProps) {
  const texts: { text: string }[] = aggregate?.texts ?? [];
  if (texts.length === 0) {
    return <p className="w-full text-center text-stage-name text-ink-subtle">Waiting for responses…</p>;
  }
  // Newest first, capped — past ~8 nothing on a projector is readable anyway.
  const shown = texts.slice(-8).reverse();
  return (
    <div className="w-full h-full overflow-hidden grid grid-cols-2 gap-stage-gap content-start">
      {shown.map((t, i) => (
        <motion.div
          key={`${t.text}-${i}`}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.default, delay: i * 0.04 }}
          className="rounded-lg bg-surface-1 shadow-line px-6 py-5 border-l-4"
          style={{ borderColor: slotFor(i).fill }}
        >
          <p className="text-stage-label font-medium text-ink leading-snug">{t.text}</p>
        </motion.div>
      ))}
    </div>
  );
}

function OEPreview() {
  return (
    <div className="h-28 rounded-md bg-surface-2 px-3 py-2.5 text-footnote text-ink-subtle">
      Type your answer…
    </div>
  );
}

export const openEnded: SlideTypeDef = {
  type: "OPEN_ENDED",
  label: "Open ended",
  hint: "Free text, shown as a feed.",
  group: "interactive",
  interactive: true,
  defaultConfig: () => ({}),
  Editor: OEEditor,
  Player: OEPlayer,
  Stage: OEStage,
  Preview: OEPreview,
};
