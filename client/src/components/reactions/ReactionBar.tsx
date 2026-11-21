import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { getSocket } from "../../lib/socket";
import { prefersReducedMotion } from "../../lib/motion";
import {
  REACTION_GLYPH,
  REACTION_KINDS,
  REACTION_LABEL,
  isReactionKind,
  type ReactionKind,
} from "./ReactionOverlay";

/**
 * Mirrors the server's bucket in `server/src/sockets/qa.ts`. The windows are
 * independent (each starts whenever that side first sees a tap), so this is not
 * a guarantee that nothing is dropped server-side — it is there so a rapid
 * tapper is told "that one didn't count" instead of watching taps vanish into
 * a fire-and-forget emit with no ack to fail on.
 */
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 5;

/** How long the pressed glyph holds its bumped state. */
const POP_MS = 170;
/** Coalescing + linger for the "room is reacting" counter. */
const FLUSH_MS = 300;
const IDLE_MS = 3000;

interface ReactionBarProps {
  joinCode: string;
  className?: string;
}

export function ReactionBar({ joinCode, className }: ReactionBarProps) {
  const [reduced] = useState(prefersReducedMotion);
  const [popped, setPopped] = useState<ReactionKind | null>(null);
  const [throttled, setThrottled] = useState(false);
  const [roomCount, setRoomCount] = useState(0);

  const bucket = useRef({ count: 0, resetAt: 0 });
  const popTimer = useRef<number | null>(null);
  const throttleTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (popTimer.current !== null) window.clearTimeout(popTimer.current);
      if (throttleTimer.current !== null) window.clearTimeout(throttleTimer.current);
    },
    []
  );

  const send = useCallback(
    (kind: ReactionKind) => {
      const now = Date.now();
      const b = bucket.current;
      if (now >= b.resetAt) {
        b.count = 1;
        b.resetAt = now + RATE_WINDOW_MS;
      } else if (b.count >= RATE_MAX) {
        setThrottled(true);
        if (throttleTimer.current !== null) window.clearTimeout(throttleTimer.current);
        throttleTimer.current = window.setTimeout(
          () => setThrottled(false),
          Math.max(0, b.resetAt - now)
        );
        return;
      } else {
        b.count += 1;
      }

      // Fire and forget — there is no ack, and the feedback below is local, so
      // a slow or flaky connection never makes the strip feel dead.
      getSocket().emit("reaction:send", { joinCode, kind });

      setThrottled(false);
      setPopped(kind);
      if (popTimer.current !== null) window.clearTimeout(popTimer.current);
      popTimer.current = window.setTimeout(() => setPopped(null), POP_MS);
    },
    [joinCode]
  );

  // Listening is what confirms the tap actually reached the room; the local pop
  // only proves the thumb landed.
  useEffect(() => {
    const socket = getSocket();
    const pending = { n: 0 };
    let flush: number | null = null;
    let idle: number | null = null;

    const onBurst = (payload: { kind?: unknown }) => {
      if (!isReactionKind(payload?.kind)) return;
      pending.n += 1;
      // A full room is ~1000 bursts a second; batch them into one render.
      if (flush === null) {
        flush = window.setTimeout(() => {
          flush = null;
          setRoomCount(pending.n);
        }, FLUSH_MS);
      }
      if (idle !== null) window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        pending.n = 0;
        setRoomCount(0);
      }, IDLE_MS);
    };

    socket.on("reaction:burst", onBurst);
    return () => {
      // Same handler reference: a bare off("reaction:burst") would also kill
      // any overlay or sibling listener on the shared socket.
      socket.off("reaction:burst", onBurst);
      if (flush !== null) window.clearTimeout(flush);
      if (idle !== null) window.clearTimeout(idle);
    };
  }, [joinCode]);

  return (
    <div
      className={cn(
        "w-full select-none",
        // No safe-area padding here: it belongs on whatever element is
        // actually bottom-most, which is the footer that mounts this bar
        // (Play.tsx) — the tablist renders after it.
        className
      )}
    >
      <div className="flex h-[var(--s-5)] items-end justify-between px-[var(--s-1)] pb-[var(--s-1)]">
        <span className="text-caption2 font-ui font-semibold uppercase track-label text-ink-subtle">
          React
        </span>
        <span
          role="status"
          aria-live="polite"
          className="text-caption2 font-ui text-ink-subtle transition-opacity duration-fast ease-standard"
        >
          {throttled
            ? "Easy — a few at a time"
            : roomCount > 0
              ? `${roomCount} from the room`
              : ""}
        </span>
      </div>

      <div
        role="group"
        aria-label="React"
        className={cn(
          "grid grid-cols-6 gap-[var(--s-1)]",
          // Honest feedback: the whole strip dims while taps are being dropped.
          throttled && "opacity-50"
        )}
      >
        {REACTION_KINDS.map((kind) => {
          const isPopped = popped === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-label={REACTION_LABEL[kind]}
              title={REACTION_LABEL[kind]}
              onPointerDown={() => send(kind)}
              // A keyboard Enter/Space fires click with detail 0 and no
              // pointerdown, so route only those through here — otherwise a
              // touch would send twice.
              onClick={(e) => {
                if (e.detail === 0) send(kind);
              }}
              className={cn(
                "flex h-14 min-w-[44px] items-center justify-center rounded-lg",
                "text-title1 leading-none touch-manipulation",
                "shadow-line transition-[transform,background-color] duration-fast ease-standard",
                isPopped ? "bg-surface-3" : "bg-surface-2",
                // The press bump, not spring.pop — overshoot is budgeted to
                // three moments and this is not one of them (DESIGN.md §4).
                // Under reduced motion the colour change carries the feedback
                // on its own.
                !reduced && (isPopped ? "scale-[1.16]" : "scale-100")
              )}
            >
              <span aria-hidden="true">{REACTION_GLYPH[kind]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ReactionBar;
