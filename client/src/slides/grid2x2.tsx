import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion } from "motion/react";
import type { EditorProps, PlayerProps, SlideTypeDef, StageProps } from "./types";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { slotFor } from "../lib/answers";
import { cn } from "../lib/cn";
import { AnsweredEcho, asPoint } from "./answeredEcho";

// 2x2 grid / matrix — players drop a single dot on a two-axis plane
// (Importance vs Effort, Impact vs Cost, …).
//
// Both coordinates go over the wire normalised to 0..1, with y running
// BOTTOM→TOP rather than in screen coordinates. Normalising at the source is
// what lets the same response render correctly on a 360px phone and a 1080p
// projector, and lets the server bucket quadrants without knowing any sizes.

interface Pt {
  x: number;
  y: number;
}

const DEFAULTS = {
  xLabelLow: "Low",
  xLabelHigh: "High",
  yLabelLow: "Low",
  yLabelHigh: "High",
};

function axisLabels(config: any) {
  return {
    xLow: config?.xLabelLow ?? DEFAULTS.xLabelLow,
    xHigh: config?.xLabelHigh ?? DEFAULTS.xLabelHigh,
    yLow: config?.yLabelLow ?? DEFAULTS.yLabelLow,
    yHigh: config?.yLabelHigh ?? DEFAULTS.yLabelHigh,
  };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Responses are one series, so they take slot A rather than the accent: the
// accent is voltage (DESIGN.md P2) and is spent here on the Submit CTA and,
// on the stage, on the single centroid marker.
const DOT = slotFor(0);

/** Arrow-key step. Coarse enough to cross the plane in a sane number of taps. */
const KEY_STEP = 0.05;

// Hoisted so the live plane and the read-only echo are the same drawing. If
// the echo's axes sat differently from the ones the player tapped on, the dot
// would appear to have moved.
const EDGE_LABEL =
  "absolute pointer-events-none select-none text-footnote font-semibold uppercase track-label text-ink-subtle max-w-[34%] text-center leading-tight";

function GridEditor({ config, onChange }: EditorProps) {
  const l = axisLabels(config);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Label htmlFor="g2-x-low">Horizontal axis</Label>
        <div className="flex items-center gap-2">
          <Input
            id="g2-x-low"
            value={l.xLow}
            maxLength={28}
            aria-label="Left end of the horizontal axis"
            onChange={(e) => onChange({ xLabelLow: e.target.value })}
          />
          <span className="shrink-0 text-ink-subtle" aria-hidden="true">
            →
          </span>
          <Input
            value={l.xHigh}
            maxLength={28}
            aria-label="Right end of the horizontal axis"
            onChange={(e) => onChange({ xLabelHigh: e.target.value })}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="g2-y-low">Vertical axis</Label>
        <div className="flex items-center gap-2">
          <Input
            id="g2-y-low"
            value={l.yLow}
            maxLength={28}
            aria-label="Bottom end of the vertical axis"
            onChange={(e) => onChange({ yLabelLow: e.target.value })}
          />
          <span className="shrink-0 text-ink-subtle" aria-hidden="true">
            →
          </span>
          <Input
            value={l.yHigh}
            maxLength={28}
            aria-label="Top end of the vertical axis"
            onChange={(e) => onChange({ yLabelHigh: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

// Read-only echo of a dot already banked on the server. Same plane, same axes,
// same marker — only the gesture is gone. Coordinates alone ("0.31, 0.78")
// would be unreadable: the whole point of this format is that position IS the
// answer, so the answer has to be shown in the space it was given in.
function GridEcho({ config, point }: { config: any; point: Pt }) {
  const l = axisLabels(config);
  return (
    <AnsweredEcho label="Where you put your dot">
      <div
        role="img"
        aria-label={`Your dot, ${Math.round(point.x * 100)}% along ${l.xLow} to ${l.xHigh}, and ${Math.round(point.y * 100)}% along ${l.yLow} to ${l.yHigh}.`}
        className="relative mx-auto w-full max-w-[min(100%,46vh)] aspect-square rounded-lg bg-surface-2 shadow-line overflow-hidden"
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-hairline" aria-hidden="true" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-hairline" aria-hidden="true" />
        <span className={cn(EDGE_LABEL, "top-2.5 left-1/2 -translate-x-1/2")}>{l.yHigh}</span>
        <span className={cn(EDGE_LABEL, "bottom-2.5 left-1/2 -translate-x-1/2")}>{l.yLow}</span>
        <span className={cn(EDGE_LABEL, "left-2.5 top-1/2 -translate-y-1/2")}>{l.xLow}</span>
        <span className={cn(EDGE_LABEL, "right-2.5 top-1/2 -translate-y-1/2")}>{l.xHigh}</span>
        <span
          className="absolute block w-9 h-9 rounded-pill -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${point.x * 100}%`,
            top: `${(1 - point.y) * 100}%`,
            background: DOT.fill,
            boxShadow: `0 0 0 3px ${DOT.ink}`,
          }}
          aria-hidden="true"
        />
      </div>
    </AnsweredEcho>
  );
}

function GridPlayer({ slide, onSubmit, disabled, value }: PlayerProps) {
  const l = axisLabels(slide.config);
  const planeRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<Pt | null>(null);

  const stored = asPoint(value);
  if (stored) return <GridEcho config={slide.config} point={stored} />;

  // The rect is measured per interaction, never cached: the plane is sized in
  // viewport units, so a rotation, an address-bar collapse or a software
  // keyboard would silently invalidate a stored one.
  function placeAt(e: PointerEvent<HTMLDivElement>) {
    const el = planeRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    setPoint({
      x: clamp01((e.clientX - r.left) / r.width),
      y: clamp01(1 - (e.clientY - r.top) / r.height),
    });
  }

  function nudge(dx: number, dy: number) {
    setPoint((p) => {
      const base = p ?? { x: 0.5, y: 0.5 };
      return { x: clamp01(base.x + dx), y: clamp01(base.y + dy) };
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault(); // otherwise the arrow also scrolls the player shell
    nudge(m[0], m[1]);
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <div
        ref={planeRef}
        role="application"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Plotting area. Horizontal: ${l.xLow} to ${l.xHigh}. Vertical: ${l.yLow} to ${l.yHigh}. Tap to place your dot, or use the arrow keys.`}
        onPointerDown={(e) => {
          // Capture so a drag that leaves the square keeps updating — the dot
          // should follow the thumb, not stop at the edge of the element.
          e.currentTarget.setPointerCapture(e.pointerId);
          placeAt(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) placeAt(e);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "relative mx-auto w-full max-w-[min(100%,66vh)] aspect-square",
          "rounded-lg bg-surface-1 shadow-line overflow-hidden",
          // touch-none: the plane owns the gesture, so the page must not
          // pan/zoom underneath a drag.
          "touch-none select-none cursor-crosshair",
          disabled && "opacity-40 pointer-events-none"
        )}
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-hairline" aria-hidden="true" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-hairline" aria-hidden="true" />

        {/* Labels sit INSIDE the edges so the touch target stays the full
            square — on a phone, label gutters would eat a third of the area. */}
        <span className={cn(EDGE_LABEL, "top-2.5 left-1/2 -translate-x-1/2")}>{l.yHigh}</span>
        <span className={cn(EDGE_LABEL, "bottom-2.5 left-1/2 -translate-x-1/2")}>{l.yLow}</span>
        <span className={cn(EDGE_LABEL, "left-2.5 top-1/2 -translate-y-1/2")}>{l.xLow}</span>
        <span className={cn(EDGE_LABEL, "right-2.5 top-1/2 -translate-y-1/2")}>{l.xHigh}</span>

        {!point && (
          // Offset from dead centre: the x-axis edge labels are themselves
          // vertically centred, so a centred hint collides with both of them.
          <span className="absolute inset-x-0 top-[30%] px-10 text-center pointer-events-none text-subhead text-ink-subtle">
            Tap anywhere to place your dot
          </span>
        )}

        {point && (
          <span
            className="absolute block w-9 h-9 rounded-pill -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${point.x * 100}%`,
              top: `${(1 - point.y) * 100}%`,
              background: DOT.fill,
              // A solid fill plus a contrasting ring, so the dot reads on the
              // surface and against the dividers it may be sitting on.
              boxShadow: `0 0 0 3px ${DOT.ink}`,
            }}
          />
        )}
      </div>

      <Button
        variant="primary"
        size="lg"
        disabled={!point || disabled}
        onClick={() => point && onSubmit(point)}
      >
        {point ? "Submit" : "Place your dot"}
      </Button>
    </div>
  );
}

function GridStage({ slide, aggregate }: StageProps) {
  const l = axisLabels(slide.config);
  const points: Pt[] = aggregate?.points ?? [];
  const centroid: Pt | null = aggregate?.centroid ?? null;
  const quadrants: number[] = aggregate?.quadrants ?? [0, 0, 0, 0];
  const total: number = aggregate?.total ?? 0;

  // Unlike the other types this keeps drawing its empty plane while it waits:
  // the room needs to read the axes to think about the question at all.
  const sideLabel =
    "text-stage-label font-semibold uppercase track-label text-ink-muted max-w-[14vw] leading-tight";
  const quadCount =
    "absolute nums text-stage-label font-bold text-ink-subtle";

  return (
    <div className="w-full flex flex-col items-center gap-[clamp(6px,1.1vh,16px)]">
      <span className={cn(sideLabel, "text-center")}>{l.yHigh}</span>

      <div className="flex items-center gap-stage-gap">
        <span className={cn(sideLabel, "text-right")}>{l.xLow}</span>

        <div className="relative w-[min(44vh,44vw)] aspect-square rounded-lg bg-surface-1 shadow-line">
          <div className="absolute inset-y-0 left-1/2 w-px bg-hairline-strong" aria-hidden="true" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-hairline-strong" aria-hidden="true" />

          <span className={cn(quadCount, "top-[2.5%] left-[3%]")}>{quadrants[2] ?? 0}</span>
          <span className={cn(quadCount, "top-[2.5%] right-[3%]")}>{quadrants[3] ?? 0}</span>
          <span className={cn(quadCount, "bottom-[2.5%] left-[3%]")}>{quadrants[0] ?? 0}</span>
          <span className={cn(quadCount, "bottom-[2.5%] right-[3%]")}>{quadrants[1] ?? 0}</span>

          {points.map((p, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 0.5, scale: 1 }}
              // Capped stagger: a full room would otherwise take ten seconds
              // to finish arriving.
              transition={{ duration: 0.32, delay: Math.min(i * 0.02, 0.6) }}
              className="absolute block w-[max(16px,1.5vw)] aspect-square rounded-pill"
              style={{
                left: `${p.x * 100}%`,
                top: `${(1 - p.y) * 100}%`,
                // Translucent, so density reads as depth where answers cluster.
                background: DOT.fill,
                marginLeft: "calc(-0.5 * max(16px, 1.5vw))",
                marginTop: "calc(-0.5 * max(16px, 1.5vw))",
              }}
            />
          ))}

          {centroid && (
            <span
              className="absolute block w-[max(26px,2.3vw)] aspect-square rounded-pill bg-accent shadow-glow"
              style={{
                left: `${centroid.x * 100}%`,
                top: `${(1 - centroid.y) * 100}%`,
                marginLeft: "calc(-0.5 * max(26px, 2.3vw))",
                marginTop: "calc(-0.5 * max(26px, 2.3vw))",
              }}
            />
          )}
        </div>

        <span className={cn(sideLabel, "text-left")}>{l.xHigh}</span>
      </div>

      <span className={cn(sideLabel, "text-center")}>{l.yLow}</span>

      <p className="text-stage-label text-ink-subtle">
        {total === 0 ? (
          "Waiting for responses…"
        ) : (
          <>
            <span className="nums font-bold text-ink">{total}</span>
            {total === 1 ? " response" : " responses"}
            <span className="text-accent"> · average marked</span>
          </>
        )}
      </p>
    </div>
  );
}

function GridPreview({ config }: { config: any; question: string }) {
  const l = axisLabels(config);
  return (
    <div className="relative aspect-square w-full rounded-md bg-surface-2 overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-hairline" />
      <div className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
      <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-caption2 uppercase track-label text-ink-subtle">
        {l.yHigh}
      </span>
      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-caption2 uppercase track-label text-ink-subtle">
        {l.yLow}
      </span>
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-caption2 uppercase track-label text-ink-subtle">
        {l.xLow}
      </span>
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-caption2 uppercase track-label text-ink-subtle">
        {l.xHigh}
      </span>
      <span
        className="absolute block w-4 h-4 rounded-pill -translate-x-1/2 -translate-y-1/2"
        style={{ left: "66%", top: "38%", background: DOT.fill, boxShadow: `0 0 0 2px ${DOT.ink}` }}
      />
    </div>
  );
}

export const grid2x2: SlideTypeDef = {
  type: "GRID_2X2",
  label: "2×2 grid",
  hint: "Plot one dot on a two-axis matrix, like Importance vs Effort.",
  group: "interactive",
  interactive: true,
  defaultConfig: () => ({ ...DEFAULTS }),
  Editor: GridEditor,
  Player: GridPlayer,
  echoesValue: true,
  Stage: GridStage,
  Preview: GridPreview,
};
