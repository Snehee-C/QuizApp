import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

interface FitTextProps {
  children: string;
  className?: string;
  /** Largest size to try, in px. */
  max?: number;
  /** Hard floor — never go below this (DESIGN.md §5: 24px on stage). */
  min?: number;
  /** Most lines the headline may occupy before it starts shrinking. */
  maxLines?: number;
}

// Fits an arbitrary-length question into its box at the largest size that still
// reads from the back of the room.
//
// This replaces a "condense before you shrink" mechanism that never ran. The
// app loaded Bricolage Grotesque specifically for its `wdth` axis, but
// `@fontsource-variable/bricolage-grotesque` resolves to a WEIGHT-ONLY build
// (`*-wght-normal.woff2`); the width axis ships in a separate `wdth.css` that
// was never imported. So `font-variation-settings: "wdth" 75` had no axis to
// move, the binary search on width was a no-op, and every long question fell
// through to the shrink path anyway — the exact behaviour the second typeface
// had been chosen to avoid, at the cost of carrying it. QA measured the result
// at 50.8px / font-stretch 100%.
//
// The honest fix is not to re-import the axis. A condensed headline sitting
// above uncondensed answer tiles is its own disharmony, and the real constraint
// was never the glyph width — it was that the headline box was a FIXED height
// that only fit two lines, which forced the shrink. So:
//
//   1. the headline box is taller (24vh), so more of the question is set big
//   2. `text-wrap: balance` evens the lines, so the last is never an orphan
//   3. only then does size come down, by binary search, floored at `min`
//
// A 300-character question is a content problem, not a typographic one: the
// system fits it as large as the box allows and does not pretend an axis is
// rescuing it. The measured result is reported in the commit, not guessed at.
export function FitText({
  children,
  className,
  max = 104,
  min = 24,
  maxLines = 4,
}: FitTextProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;

    const measure = () => {
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      if (!bw || !bh) return;

      // Overflow is "wider than the box, taller than the box, or more lines
      // than we allow" — the line cap is what keeps a long question from
      // becoming a readable-but-endless paragraph on the projector.
      const overflows = (px: number) => {
        text.style.fontSize = `${px}px`;
        const lineHeight = px * LEADING;
        if (text.scrollWidth > bw + 0.5) return true;
        if (text.scrollHeight > bh + 0.5) return true;
        return Math.round(text.scrollHeight / lineHeight) > maxLines;
      };

      if (!overflows(max)) {
        setSize(max);
        return;
      }

      let lo = min;
      let hi = max;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (overflows(mid)) hi = mid;
        else lo = mid;
      }
      setSize(lo);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [children, max, min, maxLines]);

  return (
    <div ref={boxRef} className={cn("w-full h-full grid place-items-center", className)}>
      <span
        ref={textRef}
        className="font-display font-bold text-center block balance"
        style={{ fontSize: size, lineHeight: LEADING, letterSpacing: "-0.028em" }}
      >
        {children}
      </span>
    </div>
  );
}

// Matches the `stage-q` step (DESIGN.md §4) so a fitted headline and a static
// one are set identically.
const LEADING = 1.06;
