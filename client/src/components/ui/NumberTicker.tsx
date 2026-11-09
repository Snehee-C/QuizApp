import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

interface NumberTickerProps {
  value: number;
  className?: string;
}

const DURATION = 850;

// Mirrors Magic UI's NumberTicker: animates the displayed integer from its
// previous value to `value` over ~850ms with an ease-out cubic. Snaps instantly
// when the user prefers reduced motion. Uses tabular-nums so digits don't jitter.
export function NumberTicker({ value, className }: NumberTickerProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (k < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value]);

  return (
    <span className={cn("tabular-nums", className)}>
      {display.toLocaleString()}
    </span>
  );
}
