import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../../lib/cn";
import { duration, prefersReducedMotion, spring } from "../../lib/motion";

/**
 * What the control bar has to say that is not a button.
 *
 * Desk-distance host chrome, so it is UI-ladder type and the AA target, and
 * it is rendered INSIDE the control bar's <footer> for the same reason the
 * slide navigator is (DESIGN.md §6, SlideNavigator.tsx): the floor audit
 * classifies by `closest("footer")`, and a strip that says "Reconnecting…"
 * must never be projected at 24px to the room. The stage itself never shows
 * it. One component for every message — the connection, a refused command,
 * a blocked pop-up, a blanked screen — because they are one kind of thing:
 * the system telling the host what it knows (PULSE.md T2).
 */
export interface Notice {
  text: string;
  /** Something is wrong, as opposed to something being reported. */
  warn?: boolean;
  /** Stays until acted on; the default is transient. */
  sticky?: boolean;
  /** A door out, when the only honest answer is to leave. */
  door?: { label: string; onSelect: () => void };
}

export function FooterNotice({
  notice,
  onDismiss,
  className,
}: {
  notice: Notice | null;
  onDismiss?: () => void;
  className?: string;
}) {
  // Read once: the preference does not change mid-session.
  const [reduced] = useState(prefersReducedMotion);
  return (
    // Always mounted so screen readers announce changes inside it
    // (ConnectionBanner.tsx has the reasoning). Empty, it renders no box.
    // One grid cell for every child: a message leaving and the message
    // replacing it overlap for the 140ms crossfade instead of stacking into a
    // column, which is what three quick status changes in a row otherwise did.
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn("select-none grid place-items-center [&>*]:col-start-1 [&>*]:row-start-1", className)}
    >
      <AnimatePresence initial={false}>
        {notice && (
          <motion.div
            key={notice.text}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: duration.fast } : spring.default}
            className={cn(
              "flex items-center gap-3 rounded-md bg-surface-2 shadow-elev-2",
              "px-4 py-2 text-subhead leading-tight font-medium"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "shrink-0 w-2 h-2 rounded-pill",
                notice.warn ? "bg-[var(--warn)]" : "bg-[var(--ink-subtle)]"
              )}
            />
            <span className={notice.warn ? "text-warn" : "text-ink"}>{notice.text}</span>
            {notice.door && (
              <button
                type="button"
                onClick={notice.door.onSelect}
                className="shrink-0 px-3 h-8 rounded-sm text-footnote font-semibold bg-surface-3 text-ink press"
              >
                {notice.door.label}
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss"
                className="shrink-0 px-2.5 h-8 rounded-sm text-footnote font-semibold text-ink-muted hover:text-ink hover:bg-surface-3 press"
              >
                Dismiss
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
