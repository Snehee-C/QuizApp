import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../lib/cn";
import { duration as dur, ease, prefersReducedMotion } from "../lib/motion";

export interface MoreAction {
  label: string;
  onSelect: () => void;
  /** Destructive actions are tinted and sorted last by the caller. */
  danger?: boolean;
}

/**
 * The actions a row has that are not the reason you came to the row.
 *
 * A deck card carried six equally-weighted controls — title, Edit, History,
 * Duplicate, Present, Delete — and a list of twenty decks therefore carried a
 * hundred and twenty. Hick's Law is the obvious cost (decision time rises with
 * the number of choices) but the sharper one is that "Delete" sat at the same
 * size, the same spacing and the same visual weight as "Present", a pixel
 * apart, on every row. Equal weight is a claim about equal frequency, and it
 * was false: a host presents a deck weekly and deletes one twice a year.
 *
 * So the two verbs a host actually came for stay on the row and the rest move
 * one layer in — progressive disclosure, which NN/g measures as improving
 * learnability, efficiency AND error rate, the last of those being precisely
 * the Delete-next-to-Present problem.
 *
 * Deliberately hand-rolled rather than `<details>`: a native disclosure does
 * not close on Escape, does not close when you click elsewhere on the page,
 * and does not return focus to its trigger — three things a menu has to do
 * before it is a menu rather than a trapdoor.
 */
export function MoreMenu({ label, actions }: { label: string; actions: MoreAction[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Focus goes back where it came from. Without this, Escape leaves focus
      // on a node that has just been removed and the browser drops it to
      // <body> — so the next Tab restarts at the top of the page, which from a
      // row twelve decks down is a worse place than where they started.
      trigger.current?.focus();
    }
    function onDown(e: PointerEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    // Capture: a menu item's own click must still land, but a click on
    // anything else must close this before that thing acts on it.
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const reduced = prefersReducedMotion();

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center justify-center font-ui font-semibold press select-none",
          "h-9 px-3.5 text-footnote rounded-sm transition-colors duration-fast",
          open ? "bg-surface-2 text-ink" : "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-1"
        )}
      >
        <span aria-hidden="true">•••</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.98 }}
            transition={{ duration: dur.fast, ease: ease.standard }}
            // Anchored to the trigger's right edge and below it, so it opens
            // where the finger already is (Fitts) and never covers the row it
            // belongs to.
            className="absolute right-0 top-full mt-1.5 z-30 min-w-[11rem] p-1 rounded-md bg-surface-2 shadow-elev-2 origin-top-right"
          >
            {actions.map((a) => (
              <button
                key={a.label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  a.onSelect();
                }}
                className={cn(
                  "w-full text-left px-3 h-9 rounded-xs text-subhead font-medium",
                  "transition-colors duration-fast outline-none focus-visible:shadow-focus",
                  a.danger
                    ? "text-danger hover:bg-[color-mix(in_oklch,var(--danger),transparent_88%)]"
                    : "text-ink-muted hover:text-ink hover:bg-surface-3"
                )}
              >
                {a.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
