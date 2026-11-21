import { useState } from "react";
import { motion } from "motion/react";
import type { EditorProps, SlideTypeDef, StageProps } from "./types";
import { FitText } from "../components/ui/FitText";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { STAGGER_LG, spring } from "../lib/motion";
import { insertAt, removeAt } from "../lib/listEdit";

// Content slides — the non-interactive half of a deck.
//
// They take no answers, so there is no Player, no grading and no reveal: the
// module's whole job is the Stage. That makes the design constraint the point
// rather than a detail — a content slide exists ONLY to be read from the back
// of a lit room, so every string on stage uses the stage type scale (24px
// floor, DESIGN.md §5). A content slide with body-copy-sized text is a bug.
//
// Present.tsx deliberately does NOT draw the question line above a
// non-interactive slide, because each of these types wants to place its own
// heading (a quote hangs differently from a bullet list). Anything the author
// typed into `question` must therefore be rendered here or it is invisible.

/** The shared outer frame: fills the stage area and centres its content. */
function StageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-[clamp(16px,3vh,44px)] text-center">
      {children}
    </div>
  );
}

/* ─────────────────────────── Heading ─────────────────────────── */

function HeadingEditor({ config, onChange }: EditorProps) {
  return (
    <div>
      <Label htmlFor="ch-sub">Subtitle</Label>
      <Input
        id="ch-sub"
        placeholder="Optional line under the heading"
        value={config.subtitle ?? ""}
        onChange={(e) => onChange({ subtitle: e.target.value })}
      />
    </div>
  );
}

function HeadingStage({ slide }: StageProps) {
  const subtitle: string = slide.config?.subtitle ?? "";
  return (
    <StageFrame>
      {/* Title and subtitle are ONE optical group, centred together. The title
          used to take `flex-1` and the subtitle `shrink-0`, which pushed them
          to opposite ends of the frame and left a dead band between a heading
          and the line that belongs to it. */}
      <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-[clamp(10px,2vh,28px)]">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.slow}
          className="w-full shrink-0 h-[min(44vh,480px)]"
        >
          <FitText max={168} min={40}>
            {slide.question}
          </FitText>
        </motion.div>
        {subtitle && (
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.default, delay: 0.1 }}
            className="shrink-0 text-stage-name text-ink-muted max-w-[72ch] text-center balance"
          >
            {subtitle}
          </motion.p>
        )}
      </div>
    </StageFrame>
  );
}

function HeadingPreview({ config, question }: { config: any; question: string }) {
  return (
    <div className="text-center px-2">
      <p className="font-display font-bold text-title2 leading-tight text-ink">
        {question || "Heading"}
      </p>
      {config.subtitle && (
        <p className="mt-2 text-footnote text-ink-muted">{config.subtitle}</p>
      )}
    </div>
  );
}

export const contentHeading: SlideTypeDef = {
  type: "CONTENT_HEADING",
  label: "Heading",
  hint: "A section title for the big screen.",
  group: "content",
  interactive: false,
  defaultConfig: () => ({ subtitle: "" }),
  questionLabel: "Heading",
  questionPlaceholder: "What is this section called?",
  Editor: HeadingEditor,
  Player: null,
  Stage: HeadingStage,
  Preview: HeadingPreview,
};

/* ─────────────────────────── Bullet list ─────────────────────────── */

const MAX_BULLETS = 6;

function BulletsEditor({ config, onChange, onRemove }: EditorProps) {
  const bullets: string[] = config.bullets ?? [];
  // Typing is buffered locally and committed on blur: every keystroke in this
  // panel otherwise round-trips a save for the whole slide.
  const [draft, setDraft] = useState<string[] | null>(null);
  const shown = draft ?? bullets;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <Label className="mb-0">Bullets</Label>
        <span className="text-caption text-ink-subtle">
          Keep them short — the room reads these at a glance
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((b, i) => (
          <div key={i} className="flex gap-2 items-center">
            <span
              className="shrink-0 w-9 h-9 grid place-items-center rounded-sm bg-surface-2 nums text-footnote text-ink-subtle"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <Input
              value={b}
              aria-label={`Bullet ${i + 1}`}
              onChange={(e) => {
                const next = [...shown];
                next[i] = e.target.value;
                setDraft(next);
              }}
              onBlur={() => {
                if (!draft) return;
                setDraft(null);
                onChange({ bullets: draft });
              }}
            />
            <button
              onClick={() => {
                setDraft(null);
                const removed = bullets[i];
                const apply = (c: any) => ({ ...c, bullets: removeAt(c.bullets ?? [], i) });
                const restore = (c: any) => ({
                  ...c,
                  bullets: insertAt(c.bullets ?? [], i, removed),
                });
                if (onRemove) onRemove({ label: `bullet ${i + 1}`, apply, restore });
                else onChange(apply(config));
              }}
              disabled={bullets.length <= 1}
              aria-label={`Remove bullet ${i + 1}`}
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
          disabled={bullets.length >= MAX_BULLETS}
          onClick={() => {
            setDraft(null);
            onChange({ bullets: [...bullets, ""] });
          }}
        >
          + Add bullet
        </Button>
      </div>
    </div>
  );
}

function BulletsStage({ slide }: StageProps) {
  // Empty rows are an editing artefact, not content — never project a blank
  // bullet with a marker next to it.
  const bullets: string[] = (slide.config?.bullets ?? []).filter(
    (b: string) => typeof b === "string" && b.trim().length > 0
  );

  return (
    <div className="w-full h-full flex flex-col justify-center gap-[clamp(20px,4vh,56px)]">
      <div className="shrink-0 h-[clamp(84px,18vh,190px)]">
        <FitText max={96} min={34}>
          {slide.question}
        </FitText>
      </div>

      <ul className="flex flex-col gap-[clamp(12px,2.4vh,32px)] self-center text-left max-w-[26ch]">
        {bullets.map((b, i) => (
          <motion.li
            key={`${i}-${b}`}
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring.default, delay: i * STAGGER_LG }}
            className="flex items-start gap-[clamp(12px,1.4vw,28px)]"
          >
            {/* Neutral marker: the accent is voltage, not decoration (P2). */}
            <span
              aria-hidden="true"
              className="shrink-0 mt-[0.45em] w-[0.34em] h-[0.34em] rounded-pill bg-ink-muted text-stage-answer"
            />
            <span className="text-stage-answer font-semibold text-ink">{b}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function BulletsPreview({ config }: { config: any; question: string }) {
  const bullets: string[] = config.bullets ?? [];
  return (
    <ul className="flex flex-col gap-2 px-1">
      {bullets.map((b, i) => (
        <li key={i} className="flex items-start gap-2 text-subhead text-ink">
          <span aria-hidden="true" className="shrink-0 mt-[7px] w-1.5 h-1.5 rounded-pill bg-ink-muted" />
          <span className={b ? "" : "text-ink-subtle"}>{b || `Bullet ${i + 1}`}</span>
        </li>
      ))}
    </ul>
  );
}

export const contentBullets: SlideTypeDef = {
  type: "CONTENT_BULLETS",
  label: "Bullet list",
  hint: "A few short points, revealed in sequence.",
  group: "content",
  interactive: false,
  defaultConfig: () => ({ bullets: ["", "", ""] }),
  questionLabel: "Heading",
  questionPlaceholder: "What are these points about?",
  Editor: BulletsEditor,
  Player: null,
  Stage: BulletsStage,
  Preview: BulletsPreview,
};

/* ─────────────────────────── Quote ─────────────────────────── */

function QuoteEditor({ config, onChange }: EditorProps) {
  return (
    <div>
      <Label htmlFor="cq-attr">Attribution</Label>
      <Input
        id="cq-attr"
        placeholder="Who said it?"
        value={config.attribution ?? ""}
        onChange={(e) => onChange({ attribution: e.target.value })}
      />
    </div>
  );
}

function QuoteStage({ slide }: StageProps) {
  const attribution: string = slide.config?.attribution ?? "";
  return (
    <StageFrame>
      <motion.figure
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.slow}
        className="w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-[clamp(12px,2.4vh,32px)] m-0"
      >
        {/* Decorative: the quotation marks around the text already announce it
            to a screen reader, and a lone glyph read aloud is noise. */}
        <span
          aria-hidden="true"
          className="shrink-0 font-display font-bold text-stage-q text-ink-subtle leading-[0.6] select-none"
        >
          “
        </span>
        <blockquote className="w-full flex-1 min-h-0 m-0">
          <FitText max={132} min={34}>
            {slide.question}
          </FitText>
        </blockquote>
        {attribution && (
          <figcaption className="shrink-0 text-stage-name text-ink-muted">
            — {attribution}
          </figcaption>
        )}
      </motion.figure>
    </StageFrame>
  );
}

function QuotePreview({ config, question }: { config: any; question: string }) {
  return (
    <div className="text-center px-2">
      <p className="font-display font-semibold italic text-body leading-snug text-ink">
        “{question || "Quote"}”
      </p>
      {config.attribution && (
        <p className="mt-2 text-footnote text-ink-muted">— {config.attribution}</p>
      )}
    </div>
  );
}

export const contentQuote: SlideTypeDef = {
  type: "CONTENT_QUOTE",
  label: "Quote",
  hint: "A pull-quote with an attribution.",
  group: "content",
  interactive: false,
  defaultConfig: () => ({ attribution: "" }),
  questionLabel: "Quote",
  questionPlaceholder: "What are they quoted as saying?",
  Editor: QuoteEditor,
  Player: null,
  Stage: QuoteStage,
  Preview: QuotePreview,
};

/* ─────────────────────────── Big number ─────────────────────────── */

function BigNumberEditor({ config, onChange }: EditorProps) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Label htmlFor="cn-value">The number</Label>
        {/* Deliberately a text field, not type=number: "£2.4m", "3×" and "87%"
            are all legitimate and none of them survive a numeric input. */}
        <Input
          id="cn-value"
          className="nums w-48 text-body"
          placeholder="87%"
          value={config.value ?? ""}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="cn-caption">Caption below</Label>
        <Input
          id="cn-caption"
          placeholder="What the number means"
          value={config.caption ?? ""}
          onChange={(e) => onChange({ caption: e.target.value })}
        />
      </div>
    </div>
  );
}

function BigNumberStage({ slide }: StageProps) {
  const value: string = slide.config?.value ?? "";
  const caption: string = slide.config?.caption ?? "";
  return (
    <StageFrame>
      {slide.question && (
        <p className="shrink-0 text-stage-name text-ink-muted max-w-[52ch]">{slide.question}</p>
      )}
      <motion.p
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring.default}
        className="shrink-0 nums font-bold text-stage-code text-ink"
      >
        {value}
      </motion.p>
      {caption && (
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.default, delay: 0.1 }}
          className="shrink-0 text-stage-name text-ink-muted max-w-[52ch]"
        >
          {caption}
        </motion.p>
      )}
    </StageFrame>
  );
}

function BigNumberPreview({ config, question }: { config: any; question: string }) {
  return (
    <div className="text-center px-2">
      {question && <p className="text-caption text-ink-muted mb-1">{question}</p>}
      <p className="nums font-bold text-display leading-none text-ink">{config.value || "—"}</p>
      {config.caption && <p className="mt-2 text-footnote text-ink-muted">{config.caption}</p>}
    </div>
  );
}

export const contentBigNumber: SlideTypeDef = {
  type: "CONTENT_BIG_NUMBER",
  label: "Big number",
  hint: "One statistic, as large as the screen allows.",
  group: "content",
  interactive: false,
  defaultConfig: () => ({ value: "", caption: "" }),
  questionLabel: "Caption above the number",
  questionPlaceholder: "Sets up the number — optional",
  Editor: BigNumberEditor,
  Player: null,
  Stage: BigNumberStage,
  Preview: BigNumberPreview,
};

/* ─────────────────────────── Image ─────────────────────────── */

/**
 * `imageUrl` is author-supplied, so it is treated as untrusted: it is only
 * ever handed to an `img src` (never an href, never interpolated into CSS),
 * and the scheme is checked so a `javascript:`/`vbscript:` string can't ride
 * in should this value ever be reused somewhere that would honour it.
 */
function imageSrc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url) return null;
  if (/^(https?:|data:image\/|blob:|\/\/|\/|\.)/i.test(url)) return url;
  return null;
}

function ImageEditor({ config, onChange }: EditorProps) {
  const src = imageSrc(config.imageUrl);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Label htmlFor="ci-url">Image URL</Label>
        <Input
          id="ci-url"
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={config.imageUrl ?? ""}
          onChange={(e) => onChange({ imageUrl: e.target.value })}
        />
        {config.imageUrl && !src && (
          <p className="mt-2 text-footnote text-warn">
            That doesn’t look like an image address. Use an https:// link.
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="ci-caption">Caption</Label>
        <Input
          id="ci-caption"
          placeholder="Optional caption, also used as the alt text"
          value={config.caption ?? ""}
          onChange={(e) => onChange({ caption: e.target.value })}
        />
      </div>
    </div>
  );
}

function ImageStage({ slide }: StageProps) {
  const src = imageSrc(slide.config?.imageUrl);
  const caption: string = slide.config?.caption ?? "";

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-[clamp(12px,2.6vh,36px)]">
      {slide.question && (
        <p className="shrink-0 font-display font-bold text-stage-q-sm text-ink text-center">
          {slide.question}
        </p>
      )}

      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        {src ? (
          // object-contain, never object-cover: a cropped chart is a wrong
          // chart, and the author cannot see the crop from the lectern.
          <img
            src={src}
            alt={caption || slide.question || ""}
            className="w-full h-full object-contain rounded-lg"
          />
        ) : (
          // A visible, readable placeholder beats a broken-image glyph: the
          // presenter finds out in the rehearsal, not in front of the room.
          <div className="w-full h-full grid place-items-center rounded-xl bg-surface-1 shadow-line">
            <span className="text-stage-answer font-semibold text-ink-subtle">No image set</span>
          </div>
        )}
      </div>

      {caption && (
        <p className="shrink-0 text-stage-name text-ink-muted text-center max-w-[64ch]">
          {caption}
        </p>
      )}
    </div>
  );
}

function ImagePreview({ config }: { config: any; question: string }) {
  const src = imageSrc(config.imageUrl);
  return (
    <div className="flex flex-col gap-2">
      <div className="h-36 rounded-md bg-surface-2 grid place-items-center overflow-hidden">
        {src ? (
          <img src={src} alt="" className="max-w-full max-h-full object-contain" />
        ) : (
          <span className="text-footnote text-ink-subtle">No image set</span>
        )}
      </div>
      {config.caption && (
        <p className="text-footnote text-ink-muted text-center">{config.caption}</p>
      )}
    </div>
  );
}

export const contentImage: SlideTypeDef = {
  type: "CONTENT_IMAGE",
  label: "Image",
  hint: "A picture on the big screen, with an optional caption.",
  group: "content",
  interactive: false,
  defaultConfig: () => ({ imageUrl: "", caption: "" }),
  questionLabel: "Title",
  questionPlaceholder: "Optional title above the image",
  Editor: ImageEditor,
  Player: null,
  Stage: ImageStage,
  Preview: ImagePreview,
};
