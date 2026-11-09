import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

interface TimerRingProps {
  /** Wall-clock ms when the slide went live (server authoritative). */
  startedAt: number | null;
  timeLimitSec: number;
  size?: number;
  stroke?: number;
  className?: string;
  onExpire?: () => void;
}

// The countdown, as a radial ring (DESIGN.md §5). A thin progress BAR is
// unreadable at projector distance and carries no tension.
//
// The sweep is driven by requestAnimationFrame against the server's startedAt
// rather than a CSS transition, so it stays truthful across a tab throttle or a
// late join. Easing a clock would be lying, so the motion is strictly linear.
export function TimerRing({
  startedAt,
  timeLimitSec,
  size = 120,
  stroke = 14,
  className,
  onExpire,
}: TimerRingProps) {
  const [remaining, setRemaining] = useState(timeLimitSec);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    if (!startedAt) {
      setRemaining(timeLimitSec);
      return;
    }
    let raf = 0;
    const tick = () => {
      const left = Math.max(0, timeLimitSec - (Date.now() - startedAt) / 1000);
      setRemaining(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
      if (left > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, timeLimitSec]);

  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remaining / timeLimitSec));
  // Colour shifts accent -> rose across the final quarter, so the room sees
  // urgency before it reads the number.
  const urgent = frac <= 0.25;
  const last3 = remaining <= 3 && remaining > 0;

  return (
    <div
      className={cn("relative grid place-items-center", last3 && "animate-tick", className)}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${Math.ceil(remaining)} seconds left`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          // Classed so forced-colors can reclaim it: SVG `stroke` is not
          // forced the way `color` and `background-color` are (index.css).
          className="timer-track"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="timer-progress"
          stroke={urgent ? "var(--danger)" : "var(--accent)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - frac)}
          style={{ transition: "stroke 300ms var(--ease-standard)" }}
        />
      </svg>
      <span
        className="nums absolute font-bold tabular-nums"
        style={{
          fontSize: size * 0.34,
          color: urgent ? "var(--danger)" : "var(--ink)",
        }}
      >
        {Math.ceil(remaining)}
      </span>
    </div>
  );
}
