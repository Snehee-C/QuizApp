import { useRef, useState, type PointerEvent } from "react";
import { motion } from "motion/react";
import type { EditorProps, PlayerProps, SlideTypeDef, StageProps } from "./types";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { slotFor } from "../lib/answers";
import { cn } from "../lib/cn";
import { AnsweredEcho, asPoint } from "./answeredEcho";

// Pin on image — players tap a spot on the author's image ("where does this
// belong?", "point at the bug").
//
// The pin travels as { x, y } normalised to 0..1 against the IMAGE's own box,
// not the viewport and not the surrounding card. That is the only framing in
// which a pin dropped on a 340px phone still lands on the same pixel of the
// picture when it is redrawn 2000px wide on the projector.

interface Pt {
  x: number;
  y: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Pins are one series, so they take slot A. Slot A is a deep blue with a pure
// white ink, which is exactly the pairing a pin needs: a solid fill plus a
// contrasting ring keeps it visible on a dark photo and on a white diagram
// alike. The accent stays reserved for voltage (DESIGN.md P2).
const PIN = slotFor(0);

/**
 * `imageUrl` is author-supplied and ends up in the DOM, so it is restricted
 * here to the schemes an image can legitimately use. It is only ever placed in
 * an <img src> — never in markup, an href, or a concatenated CSS url() — so a
 * hostile value has no sink to reach even before this filter.
 */
function imageSrc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:image\//i.test(url)) return url;
  if (url.startsWith("/")) return url; // same-origin upload path
  return null;
}

function caption(config: any): string {
  return typeof config?.caption === "string" ? config.caption.trim() : "";
}

function PinEditor({ config, onChange }: EditorProps) {
  const url = typeof config?.imageUrl === "string" ? config.imageUrl : "";
  const src = imageSrc(url);
  const [broken, setBroken] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Label htmlFor="pin-url">Image URL</Label>
        <Input
          id="pin-url"
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={url}
          onChange={(e) => {
            setBroken(false);
            onChange({ imageUrl: e.target.value });
          }}
        />
      </div>

      <div>
        <Label htmlFor="pin-caption">Caption (optional)</Label>
        <Input
          id="pin-caption"
          placeholder="Shown under the image"
          maxLength={120}
          value={typeof config?.caption === "string" ? config.caption : ""}
          onChange={(e) => onChange({ caption: e.target.value })}
        />
      </div>

      {/* A live preview is the only honest way to tell a typo'd URL from a
          hotlink the host blocks — both look identical in the text field. */}
      <div>
        <Label>Preview</Label>
        <div className="rounded-md bg-surface-2 shadow-line p-3 grid place-items-center min-h-[140px]">
          {src && !broken ? (
            <img
              key={src}
              src={src}
              alt=""
              onError={() => setBroken(true)}
              className="max-h-[220px] max-w-full rounded-sm"
            />
          ) : (
            <p className="text-footnote text-ink-subtle text-center px-4">
              {src ? "That image could not be loaded." : "No image set yet."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Read-only echo of a pin already banked on the server. The coordinates are
// stored against the image's own box, so the only honest way to show them back
// is on the image: "0.42, 0.67" is not an answer anybody recognises.
//
// It keeps its own `ratio` state for the same reason the live surface does —
// the wrapper must be exactly the painted image or the pin lands off by
// whatever letterboxing crept in.
function PinEcho({ src, cap, alt, point }: { src: string; cap: string; alt: string; point: Pt }) {
  const [ratio, setRatio] = useState(16 / 9);
  return (
    <AnsweredEcho label="Where you dropped your pin">
      <div
        className="relative self-center w-full rounded-md overflow-hidden"
        style={{ aspectRatio: ratio, maxHeight: "min(52vh, 520px)" }}
      >
        <img
          key={src}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0) setRatio(img.naturalWidth / img.naturalHeight);
          }}
          className="block w-full h-full"
        />
        <span
          className="absolute block w-7 h-7 rounded-pill -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${point.x * 100}%`,
            top: `${point.y * 100}%`,
            background: PIN.fill,
            boxShadow: `0 0 0 3px ${PIN.ink}`,
          }}
          aria-hidden="true"
        />
      </div>
      {cap && <p className="text-subhead text-ink-muted text-center">{cap}</p>}
    </AnsweredEcho>
  );
}

function PinPlayer({ slide, onSubmit, disabled, value }: PlayerProps) {
  const src = imageSrc(slide.config?.imageUrl);
  const cap = caption(slide.config);
  const imgRef = useRef<HTMLImageElement>(null);
  const [pin, setPin] = useState<Pt | null>(null);
  // Default 16/9 until the image reports its own shape, so the box doesn't jump.
  const [ratio, setRatio] = useState(16 / 9);
  const [broken, setBroken] = useState(false);

  // Echo before the no-image fallback: if the image has since been removed
  // from the slide there is nothing to pin the answer onto, so the shell's
  // plain "already answered" lock is the honest result and this falls through.
  const stored = asPoint(value);
  if (stored && src && !broken) {
    return <PinEcho src={src} cap={cap} alt={slide.question} point={stored} />;
  }

  if (!src || broken) {
    return (
      <div className="w-full rounded-lg bg-surface-1 shadow-line px-6 py-10 text-center">
        <p className="text-callout font-semibold text-ink">No image set yet</p>
        <p className="mt-1.5 text-subhead text-ink-muted">
          Nothing to pin until the presenter adds one.
        </p>
        {/* Keep the broken <img> mounted-but-hidden so a late-loading or
            retried image can still flip the surface back into a usable state. */}
        {src && (
          <img
            key={src}
            src={src}
            alt=""
            className="hidden"
            onLoad={() => setBroken(false)}
          />
        )}
      </div>
    );
  }

  // Measured per interaction: the image reflows with the viewport, and a
  // cached rect would put every pin after a rotation in the wrong place.
  function placeAt(e: PointerEvent<HTMLDivElement>) {
    const el = imgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    setPin({
      x: clamp01((e.clientX - r.left) / r.width),
      y: clamp01((e.clientY - r.top) / r.height),
    });
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <div
        // The wrapper carries the image's own aspect ratio so its box is
        // exactly the painted image: pins are stored as percentages of this
        // box, so any letterboxing inside it would offset every pin. Sizing it
        // this way also lets a small source scale UP, instead of sitting tiny
        // in the middle of a phone screen.
        className={cn(
          "relative self-center w-full rounded-lg overflow-hidden shadow-line",
          "touch-none select-none cursor-crosshair",
          disabled && "opacity-40 pointer-events-none"
        )}
        style={{ aspectRatio: ratio, maxHeight: "min(62vh, 620px)" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          placeAt(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) placeAt(e);
        }}
      >
        <img
          ref={imgRef}
          key={src}
          src={src}
          alt={slide.question}
          draggable={false}
          onError={() => setBroken(true)}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0) setRatio(img.naturalWidth / img.naturalHeight);
          }}
          className="block w-full h-full pointer-events-none"
        />
        {pin && (
          <span
            className="absolute block w-7 h-7 rounded-pill -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${pin.x * 100}%`,
              top: `${pin.y * 100}%`,
              background: PIN.fill,
              boxShadow: `0 0 0 3px ${PIN.ink}`,
            }}
          />
        )}
      </div>

      {cap && <p className="text-subhead text-ink-muted text-center">{cap}</p>}

      <Button
        variant="primary"
        size="lg"
        disabled={!pin || disabled}
        onClick={() => pin && onSubmit(pin)}
      >
        {pin ? "Submit" : "Tap the image to drop a pin"}
      </Button>
    </div>
  );
}

function PinStage({ slide, aggregate }: StageProps) {
  const src = imageSrc(slide.config?.imageUrl);
  const cap = caption(slide.config);
  const points: Pt[] = aggregate?.points ?? [];
  const total: number = aggregate?.total ?? 0;
  // Default 16/9 until the image reports its own shape, so the box does not
  // jump on load.
  const [ratio, setRatio] = useState(16 / 9);

  if (!src) {
    return (
      <p className="w-full text-center text-stage-name text-ink-subtle">No image set yet</p>
    );
  }

  return (
    <div className="w-full flex flex-col items-center gap-[clamp(8px,1.4vh,20px)]">
      <div
        className="relative rounded-lg overflow-hidden shadow-line w-auto"
        style={{ aspectRatio: ratio, height: "min(52vh, 760px)", maxWidth: "100%" }}
      >
        <img
          src={src}
          alt={slide.question}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0) setRatio(img.naturalWidth / img.naturalHeight);
          }}
          className="block w-full h-full"
        />
        {points.map((p, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            // Capped stagger — a full room must not take ten seconds to land.
            transition={{ duration: 0.32, delay: Math.min(i * 0.02, 0.6) }}
            className="absolute block w-[max(20px,1.6vw)] aspect-square rounded-pill"
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              marginLeft: "calc(-0.5 * max(20px, 1.6vw))",
              marginTop: "calc(-0.5 * max(20px, 1.6vw))",
              // Solid fill + contrasting ring: the pin has to survive landing
              // on a white diagram and on a near-black photograph.
              background: PIN.fill,
              boxShadow: `0 0 0 max(3px, 0.2vw) ${PIN.ink}`,
            }}
          />
        ))}
      </div>

      <p className="text-stage-label text-ink-subtle text-center">
        {cap && <span className="text-ink-muted">{cap} · </span>}
        {total === 0 ? (
          "Waiting for responses…"
        ) : (
          <>
            <span className="nums font-bold text-ink">{total}</span>
            {total === 1 ? " pin" : " pins"}
          </>
        )}
      </p>
    </div>
  );
}

function PinPreview({ config }: { config: any; question: string }) {
  const src = imageSrc(config?.imageUrl);
  if (!src) {
    return (
      <div className="h-32 rounded-md bg-surface-2 grid place-items-center text-footnote text-ink-subtle">
        No image set yet
      </div>
    );
  }
  return (
    <div className="relative rounded-md overflow-hidden bg-surface-2">
      <img src={src} alt="" className="block w-full max-h-40 object-contain" />
      <span
        className="absolute block w-4 h-4 rounded-pill -translate-x-1/2 -translate-y-1/2"
        style={{ left: "52%", top: "46%", background: PIN.fill, boxShadow: `0 0 0 2px ${PIN.ink}` }}
      />
    </div>
  );
}

export const pinOnImage: SlideTypeDef = {
  type: "PIN_ON_IMAGE",
  label: "Pin on image",
  hint: "Players tap a spot on your image; every pin lands on the big screen.",
  group: "interactive",
  interactive: true,
  defaultConfig: () => ({ imageUrl: "", caption: "" }),
  Editor: PinEditor,
  Player: PinPlayer,
  echoesValue: true,
  Stage: PinStage,
  Preview: PinPreview,
};
