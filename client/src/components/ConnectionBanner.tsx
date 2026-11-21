import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../lib/cn";
import { duration, prefersReducedMotion, spring } from "../lib/motion";
import { useConnection, type ConnectionStatus } from "../lib/connection";

interface ConnectionBannerProps {
  className?: string;
}

/**
 * What the strip says, in plain language. No jargon ("socket", "transport",
 * "websocket") — the player's only question is "is my answer going to count?",
 * so every string answers exactly that.
 */
function message(status: ConnectionStatus, queued: number): string | null {
  if (status === "offline") {
    return queued > 0
      ? "You're offline — your answer will send when you're back"
      : "You're offline — trying to get you back";
  }
  if (status === "reconnecting") return "Reconnecting…";
  if (status === "connecting") return "Connecting…";
  // Online but still unconfirmed: the emit is in flight or waiting on a flush.
  if (queued > 0) return "Sending your answer…";
  return null;
}

/**
 * How long an unconfirmed submission on a HEALTHY link sits before the strip
 * says so. The queue notifies synchronously on enqueue, so without this the
 * warning-shaped strip sprang in and straight back out on every 40–80ms ack —
 * an indicator that appears on every healthy action is itself a defect
 * (PULSE T1, the inverse clause). Past this it is true: something is slow.
 */
const PENDING_GRACE_MS = 400;

/**
 * A thin, non-blocking status strip for flaky venue Wi-Fi.
 *
 * Shown only when something is actually wrong or pending. A permanent
 * connection indicator is noise on a screen whose whole job is four answer
 * tiles, and it trains players to ignore the one moment it matters.
 */
export function ConnectionBanner({ className }: ConnectionBannerProps) {
  const { status, queued } = useConnection();
  // Read once: the preference does not change mid-question, and re-reading per
  // render would mean a matchMedia call on every status tick.
  const [reduced] = useState(prefersReducedMotion);

  // Only the "Sending your answer…" case is held back. An outage is reported
  // the moment it is known (T2: within a second), because that message is
  // never a false alarm.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (queued === 0) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), PENDING_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [queued]);

  const pending = status === "offline" || status === "reconnecting" || status === "connecting";
  const text = message(status, pending || slow ? queued : 0);

  return (
    // The live region is always mounted, even while empty. Screen readers
    // announce *changes inside* a live region; inserting the region and its
    // text in the same frame is unreliably announced in several of them.
    // Empty, it renders no box, no background and no height — nothing to see.
    //
    // `pointer-events-none` guarantees the strip can never swallow a tap meant
    // for an answer tile or the reaction bar underneath it.
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn("pointer-events-none select-none", className)}
    >
      <AnimatePresence initial={false}>
        {text && (
          <motion.div
            key={text}
            initial={{ opacity: 0, y: reduced ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            // Reduced motion keeps the 120ms-ish opacity crossfade and drops
            // the travel entirely (DESIGN.md §6).
            transition={reduced ? { duration: duration.fast } : spring.default}
            className={cn(
              "flex items-center justify-center gap-2.5",
              "rounded-md bg-surface-2 shadow-elev-1",
              "px-3.5 py-2 text-footnote leading-tight font-medium"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "shrink-0 w-1.5 h-1.5 rounded-pill",
                pending ? "bg-[var(--warn)]" : "bg-[var(--ink-subtle)]"
              )}
            />
            <span className={pending ? "text-warn" : "text-ink-muted"}>{text}</span>
            {queued > 0 && (pending || slow) && (
              <span className="text-ink-subtle">
                <span className="nums font-semibold text-ink">{queued}</span> waiting
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ConnectionBanner;
