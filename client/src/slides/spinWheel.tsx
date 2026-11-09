import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { EditorProps, SlideTypeDef, StageProps } from "./types";
import { FitText } from "../components/ui/FitText";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { Shape } from "../components/ui/Shape";
import { slotFor } from "../lib/answers";
import { prefersReducedMotion, spring } from "../lib/motion";
import { cn } from "../lib/cn";

// Spin the wheel — a host-driven randomiser for picking a name, a team or a
// topic out of a hat in front of the room.
//
// It takes no answers, so like the content group it is non-interactive: no
// Player, no grading, no reveal. The whole module is the Stage, and the whole
// Stage is one question — does the room believe the draw was fair? Everything
// below serves that: the pointer is fixed, the wheel is the only thing that
// moves, and the name the pointer stops on is the name that is announced.
//
// Present.tsx does not draw the question line above a non-interactive slide
// (each content type places its own heading), so this module renders
// `slide.question` itself or the author's title is invisible.

const MIN_ENTRIES = 2;
/** Six answer slots exist, so twelve is two clean laps of the hue ladder. */
const MAX_ENTRIES = 12;

/* ─────────────────────────── Wheel geometry ─────────────────────────── */
//
// One viewBox shared by the stage and the preview so a single set of numbers
// describes the wheel at every size. Radii are in viewBox units; the half-view
// is wider than the wheel to leave room for the pointer overhanging the rim.

const R = 100;
const VIEW_HALF = 116;
const VIEW = VIEW_HALF * 2;
const HUB_R = 12;
/** Labels run radially between these two radii. */
const LABEL_INNER = 15;
const LABEL_OUTER = 96;
const LABEL_LEN = LABEL_OUTER - LABEL_INNER;
const LABEL_MID = (LABEL_INNER + LABEL_OUTER) / 2;
/** Rough advance width of Geist at 1em, used to size and truncate labels. */
const CHAR_W = 0.52;
/** Label size when nothing forces it smaller, in viewBox units. */
const NATURAL_FONT = 13.5;
/** DESIGN.md §5 — nothing on the stage renders below this. */
const STAGE_FLOOR_PX = 24;

const SPIN_SEC = 4.6;
/** Whole turns before the landing angle, so the stop reads as a result. */
const SPIN_TURNS = 5;

/** Point on a circle, with 0° at twelve o'clock and angles running clockwise. */
function polar(radius: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [radius * Math.cos(rad), radius * Math.sin(rad)];
}

function segmentPath(from: number, to: number): string {
  const [x0, y0] = polar(R, from);
  const [x1, y1] = polar(R, to);
  const largeArc = to - from > 180 ? 1 : 0;
  return `M 0 0 L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

/**
 * The rotation that parks segment `index` under the pointer at twelve o'clock.
 *
 * THIS IS THE WHOLE TRICK. The winner is drawn first and the angle is derived
 * from it — never the other way round. Spinning by a random angle and reading
 * off whatever the pointer covers has to re-derive the index from a float, and
 * at a segment boundary that lands one slot off the name the room just watched
 * stop under the marker. Deriving the angle instead makes the two agree by
 * construction.
 *
 * Always resolves forward of `from`, so a re-spin never rewinds.
 */
function rotationFor(index: number, count: number, from: number): number {
  const seg = 360 / count;
  const centre = index * seg + seg / 2;
  const landing = (360 - (centre % 360)) % 360;
  return Math.ceil(from / 360) * 360 + SPIN_TURNS * 360 + landing;
}

function readEntries(config: any): string[] {
  const raw = Array.isArray(config?.entries) ? config.entries : [];
  return raw.map((e: unknown) => (typeof e === "string" ? e : String(e ?? "")));
}

interface WheelProps {
  entries: string[];
  /** Rendered edge length in CSS pixels — labels are sized against it. */
  px: number;
  rotation: number;
  /** 0 means snap, which is also the reduced-motion path. */
  durationSec: number;
  /** Off for the editor miniature, where a readable label cannot fit anyway. */
  labels: boolean;
  onSettled?: () => void;
}

function Wheel({ entries, px, rotation, durationSec, labels, onSettled }: WheelProps) {
  const count = entries.length;
  const seg = 360 / count;

  // Label sizing, in priority order: shrink the whole set to fit the longest
  // entry, never below the 24px floor once converted back to CSS pixels, and
  // only then truncate whatever still overruns. Shrink-then-truncate keeps a
  // name intact wherever that is possible at all; one size for every label
  // keeps the wheel from looking like a ransom note.
  const floorUnits = px > 0 ? (STAGE_FLOOR_PX * VIEW) / px : NATURAL_FONT;
  const longest = entries.reduce((m, e) => Math.max(m, e.trim().length || 1), 1);
  const fitUnits = LABEL_LEN / (longest * CHAR_W);
  // Vertical room inside a wedge at the label's midpoint — binds only once the
  // entry count gets high.
  const chordUnits = 2 * LABEL_MID * Math.sin(Math.PI / count) * 0.78;
  const font = Math.max(floorUnits, Math.min(NATURAL_FONT, fitUnits, chordUnits));
  const maxChars = Math.max(3, Math.floor(LABEL_LEN / (font * CHAR_W)));

  return (
    <svg
      width={px}
      height={px}
      viewBox={`${-VIEW_HALF} ${-VIEW_HALF} ${VIEW} ${VIEW}`}
      role="img"
      aria-label={`Wheel of ${count} entries: ${entries.join(", ")}`}
      focusable="false"
      className="block"
    >
      {/* Inline SVG rather than canvas: the stage is a projector at an unknown
          resolution, and vector segments and labels stay crisp at any size. */}
      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          // fill-box pins the origin to the wheel's own centre, which the
          // viewBox keyword `center` would resolve against the padded view.
          transformBox: "fill-box",
          transformOrigin: "center",
          transition: durationSec > 0 ? `transform ${durationSec}s cubic-bezier(0.16, 1, 0.3, 1)` : "none",
        }}
        onTransitionEnd={(e) => {
          if (e.propertyName === "transform") onSettled?.();
        }}
      >
        {entries.map((entry, i) => {
          const slot = slotFor(i);
          const mid = i * seg + seg / 2;
          // Past six o'clock a radial label would read upside down, so it is
          // turned over and anchored from the other end of the same radius.
          const flipped = mid > 180;
          const text = entry.trim() || `Entry ${i + 1}`;
          const shown = text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
          return (
            <g key={i}>
              <path d={segmentPath(i * seg, (i + 1) * seg)} fill={slot.fill} />
              {labels && (
                <text
                  transform={`rotate(${(mid - 90 + (flipped ? 180 : 0)).toFixed(2)})`}
                  x={flipped ? -LABEL_OUTER : LABEL_OUTER}
                  y={0}
                  textAnchor={flipped ? "start" : "end"}
                  dominantBaseline="central"
                  fill={slot.ink}
                  fontSize={font.toFixed(2)}
                  fontWeight={600}
                  className="font-ui select-none"
                >
                  {shown}
                </text>
              )}
            </g>
          );
        })}
        {/* Hairline rim and hub. The rim separates the wheel from a canvas the
            same lightness as one of the slots. */}
        <circle cx={0} cy={0} r={R} fill="none" stroke="var(--hairline-str)" strokeWidth={1.5} />
        <circle cx={0} cy={0} r={HUB_R} fill="var(--surface-1)" stroke="var(--hairline-str)" strokeWidth={1.5} />
      </g>

      {/* The pointer sits OUTSIDE the rotating group: it is the fixed frame of
          reference that makes the stop legible. */}
      <path
        d={`M 0 ${-R + 10} L -10 ${-R - 12} L 10 ${-R - 12} Z`}
        fill="var(--ink)"
        stroke="var(--canvas)"
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Largest square the stage area can give the wheel, in CSS pixels. */
function useSquareSize(ref: React.RefObject<HTMLDivElement | null>): number {
  const [size, setSize] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize(Math.max(0, Math.min(el.clientWidth, el.clientHeight)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}

/* ─────────────────────────── Editor ─────────────────────────── */

function SpinWheelEditor({ config, onChange }: EditorProps) {
  const entries = readEntries(config);
  // Keystrokes are buffered locally and committed on blur: otherwise every
  // character round-trips a save of the whole slide.
  const [draft, setDraft] = useState<string[] | null>(null);
  const shown = draft ?? entries;

  function commit(next: string[]) {
    setDraft(null);
    onChange({ entries: next });
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <Label className="mb-0">Entries</Label>
        <span className="text-caption text-ink-subtle">
          Short labels — these have to fit inside a wedge
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((entry, i) => {
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
                value={entry}
                aria-label={`Entry ${i + 1}`}
                onChange={(e) => {
                  const next = [...shown];
                  next[i] = e.target.value;
                  setDraft(next);
                }}
                onBlur={() => draft && commit(draft)}
              />
              <button
                onClick={() => {
                  setDraft(null);
                  onChange({ entries: entries.filter((_, j) => j !== i) });
                }}
                disabled={entries.length <= MIN_ENTRIES}
                aria-label={`Remove entry ${i + 1}`}
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
          disabled={entries.length >= MAX_ENTRIES}
          onClick={() => {
            setDraft(null);
            onChange({ entries: [...entries, `Name ${entries.length + 1}`] });
          }}
        >
          + Add entry
        </Button>
      </div>

      <p className="mt-4 text-footnote text-ink-subtle">
        The host spins from the big screen — phones show nothing for this slide.
      </p>
    </div>
  );
}

/* ─────────────────────────── Stage ─────────────────────────── */

function SpinWheelStage({ slide }: StageProps) {
  const entries = readEntries(slide.config);
  const boxRef = useRef<HTMLDivElement>(null);
  const size = useSquareSize(boxRef);

  // Rest position 0 puts the pointer exactly on a segment boundary, which is
  // the honest reading of "nothing has been drawn yet". Parking it on a centre
  // would look like a result nobody announced.
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  /** The already-drawn winner, held until the wheel finishes travelling. */
  const pending = useRef<number | null>(null);

  // Editing the entries mid-session invalidates a displayed winner — the index
  // may not even name the same person any more.
  const signature = entries.join(" ");
  useEffect(() => {
    pending.current = null;
    setSpinning(false);
    setWinner(null);
  }, [signature]);

  if (entries.length < MIN_ENTRIES) {
    return (
      <p className="w-full text-center text-stage-name text-ink-subtle">
        Add at least two entries to spin.
      </p>
    );
  }

  function spin() {
    if (spinning) return;
    // Draw first, then derive the angle. See rotationFor().
    const index = Math.floor(Math.random() * entries.length);
    const next = rotationFor(index, entries.length, rotation);

    if (prefersReducedMotion()) {
      // The spin is pure spectacle; the result is the content. So drop the
      // travel, park the wheel on the winning segment and announce it at once
      // — no motion, same outcome (DESIGN.md §6).
      pending.current = null;
      setRotation(next);
      setWinner(index);
      return;
    }

    pending.current = index;
    setWinner(null);
    setSpinning(true);
    setRotation(next);
  }

  const winnerName = winner != null ? (entries[winner]?.trim() || `Entry ${winner + 1}`) : null;
  const winnerSlot = winner != null ? slotFor(winner) : null;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-[clamp(10px,2vh,28px)]">
      {slide.question && (
        <div className="shrink-0 w-full h-[clamp(52px,9vh,108px)]">
          <FitText max={80} min={28}>
            {slide.question}
          </FitText>
        </div>
      )}

      <div ref={boxRef} className="flex-1 min-h-0 w-full grid place-items-center">
        {size > 0 && (
          <Wheel
            entries={entries}
            px={size}
            rotation={rotation}
            durationSec={spinning ? SPIN_SEC : 0}
            labels
            onSettled={() => {
              if (pending.current == null) return;
              setWinner(pending.current);
              pending.current = null;
              setSpinning(false);
            }}
          />
        )}
      </div>

      <div className="shrink-0 flex flex-col items-center gap-[clamp(8px,1.6vh,22px)] min-h-[clamp(96px,18vh,200px)] justify-center">
        {/* Announced politely rather than assertively: the room already saw it,
            and this should not interrupt a screen reader mid-sentence. */}
        <div aria-live="polite" className="text-center">
          {winnerName && winnerSlot && (
            <motion.div
              key={`${winner}-${rotation}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.default}
            >
              <span className="block text-stage-label font-semibold uppercase track-label text-ink-muted mb-1">
                Winner
              </span>
              <span className="inline-flex items-center gap-[0.4em] max-w-[18ch]">
                {/* Shape and hue tie the name back to the wedge it came from,
                    so neither channel carries the result alone. */}
                <Shape
                  shape={winnerSlot.shape}
                  size="0.7em"
                  className="shrink-0"
                  style={{ color: winnerSlot.fill }}
                />
                <span
                  className={cn(
                    "font-display font-bold text-ink break-words",
                    winnerName.length > 14 ? "text-stage-q-sm" : "text-stage-q"
                  )}
                >
                  {winnerName}
                </span>
              </span>
            </motion.div>
          )}
        </div>

        <Button
          variant="primary"
          size="lg"
          disabled={spinning}
          onClick={spin}
          className="text-stage-answer h-auto px-[1.1em] py-[0.45em] rounded-xl"
        >
          {spinning ? "Spinning…" : winner != null ? "Spin again" : "Spin"}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Preview ─────────────────────────── */

function SpinWheelPreview({ config }: { config: any; question: string }) {
  const entries = readEntries(config);
  if (entries.length < MIN_ENTRIES) {
    return <p className="text-footnote text-ink-subtle text-center">Add at least two entries.</p>;
  }
  // No labels at thumbnail size: anything that fits here would be unreadable,
  // and a false impression of the label size is worse than none.
  return (
    <div className="grid place-items-center">
      <Wheel entries={entries} px={148} rotation={0} durationSec={0} labels={false} />
    </div>
  );
}

export const spinWheel: SlideTypeDef = {
  type: "SPIN_WHEEL",
  label: "Spin the wheel",
  hint: "Pick a name at random, live on the big screen.",
  group: "content",
  interactive: false,
  defaultConfig: () => ({
    entries: ["Name 1", "Name 2", "Name 3", "Name 4"],
  }),
  questionLabel: "Title",
  questionPlaceholder: "What is the wheel deciding?",
  Editor: SpinWheelEditor,
  Player: null,
  Stage: SpinWheelStage,
  Preview: SpinWheelPreview,
};
