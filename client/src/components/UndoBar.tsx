import { motion, AnimatePresence } from "motion/react";
import { Button } from "./ui/Button";
import { duration as dur, ease, prefersReducedMotion } from "../lib/motion";
import type { PendingDelete } from "../lib/undoDelete";

/**
 * "Deleted. Undo?"
 *
 * The visible half of `lib/undoDelete.ts`. It replaces a `window.confirm()`,
 * so the comparison that matters is not "is a snackbar nice" but "which of
 * these two costs less": the confirm interrupted every correct deletion to
 * catch the rare wrong one, and this interrupts none of them while catching
 * all of them.
 *
 * The elapsing bar is not decoration — it is the only thing that says the
 * offer expires. Without it an undo control looks permanent, and a person who
 * looks away for ten seconds learns otherwise the hard way. It runs `linear`
 * for the same reason the countdown ring does: a clock that accelerates is
 * lying (DESIGN.md §4).
 *
 * `role="status"` rather than `alert`: this is the outcome of something the
 * person just did deliberately, not an interruption, and an assertive live
 * region would talk over whatever they moved on to.
 */
export function UndoBar({
  pending,
  windowMs,
  onUndo,
}: {
  pending: PendingDelete | null;
  windowMs: number;
  onUndo: (key: string) => void;
}) {
  const reduced = prefersReducedMotion();

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          // Keyed so a second delete during the first one's window restarts
          // the bar rather than letting a stale sliver run out under new text.
          key={pending.key}
          role="status"
          initial={{ opacity: 0, y: reduced ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : 8 }}
          transition={{ duration: dur.base, ease: ease.standard }}
          className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 w-[min(26rem,calc(100vw-2rem))]"
        >
          <div className="relative overflow-hidden rounded-md bg-surface-2 shadow-elev-3">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <p className="min-w-0 text-subhead text-ink">
                <span className="font-semibold">Deleted</span>{" "}
                <span className="text-ink-subtle truncate">{pending.label}</span>
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => onUndo(pending.key)}
              >
                Undo
              </Button>
            </div>
            {/* Reduced motion keeps the bar but not the sweep: the information
                is "this expires", and a static full-width rule still says the
                offer is live without animating anything. */}
            <motion.div
              aria-hidden="true"
              className="absolute left-0 bottom-0 h-0.5 bg-accent"
              initial={{ width: "100%" }}
              animate={{ width: reduced ? "100%" : "0%" }}
              transition={{ duration: windowMs / 1000, ease: "linear" }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
