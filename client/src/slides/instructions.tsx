import { motion } from "motion/react";
import type { EditorProps, SlideTypeDef, StageProps } from "./types";
import { FitText } from "../components/ui/FitText";
import { STAGGER_LG, spring } from "../lib/motion";

// "How to join" — the slide a host drops in front of a deck so latecomers can
// catch up without the host narrating the same three sentences again.
//
// It deliberately does NOT print the join code or the room URL. The Stage
// contract passes only `slide`, `aggregate`, `revealed` and `reveal`, so a
// slide module has no access to the live session, and the lobby already shows
// the real code at ~210px with a QR beside it (DESIGN.md §5). Printing a
// stale or invented code here would be worse than printing none: the room
// would type it in and fail. So the steps stay evergreen and point at the
// screen that does hold the truth.

const STEPS = [
  "Open the link on your phone",
  "Enter the code shown on screen",
  "Answer on your own screen",
];

function InstructionsEditor(_: EditorProps) {
  return (
    <p className="text-subhead text-ink-subtle">
      Shows the three steps for joining. The live join code and QR stay on the
      lobby screen, so this slide never shows a code that has gone stale.
    </p>
  );
}

function InstructionsStage({ slide }: StageProps) {
  return (
    <div className="w-full h-full flex flex-col justify-center gap-[clamp(20px,4.5vh,64px)]">
      <div className="shrink-0 h-[clamp(84px,18vh,180px)]">
        <FitText max={104} min={34}>
          {slide.question || "How to join"}
        </FitText>
      </div>

      <ol className="self-center flex flex-col gap-[clamp(14px,3vh,40px)] text-left">
        {STEPS.map((step, i) => (
          <motion.li
            key={step}
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring.default, delay: i * STAGGER_LG }}
            className="flex items-center gap-[clamp(16px,1.8vw,40px)]"
          >
            {/* The step number is a redundant channel alongside the vertical
                order — the room scans this, it doesn't read it. */}
            <span
              aria-hidden="true"
              className="shrink-0 grid place-items-center rounded-pill bg-surface-2 text-ink nums font-bold text-stage-answer w-[1.9em] h-[1.9em]"
            >
              {i + 1}
            </span>
            <span className="text-stage-answer font-semibold text-ink">{step}</span>
          </motion.li>
        ))}
      </ol>

      <p className="shrink-0 text-center text-stage-name text-ink-muted">
        The code is on the screen behind this one.
      </p>
    </div>
  );
}

function InstructionsPreview() {
  return (
    <ol className="flex flex-col gap-2 px-1">
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-2.5 text-subhead text-ink">
          <span
            aria-hidden="true"
            className="shrink-0 w-6 h-6 grid place-items-center rounded-pill bg-surface-2 nums text-caption font-bold"
          >
            {i + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}

export const contentInstructions: SlideTypeDef = {
  type: "CONTENT_INSTRUCTIONS",
  label: "How to join",
  hint: "A 1-2-3 explainer for people arriving late.",
  group: "content",
  interactive: false,
  defaultConfig: () => ({}),
  questionLabel: "Heading",
  questionPlaceholder: "How to join",
  Editor: InstructionsEditor,
  Player: null,
  Stage: InstructionsStage,
  Preview: InstructionsPreview,
};
