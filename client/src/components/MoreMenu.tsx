import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../lib/cn";
import { duration as dur, ease, prefersReducedMotion } from "../lib/motion";
import { useArrowFocus } from "../lib/arrowFocus";

export interface MoreAction {
  label: string;
  onSelect: () => void;
  /** Destructive actions are tinted and sorted last by the caller. */
  danger?: boolean;
  /**
   * Current value, shown right-aligned. A setting in a menu has to say what it
   * is set to — otherwise the menu answers "what can I change" and not "what
   * is it now", and the host has to open it, act, and look at the result to
   * find out (NN/g: visibility of system status).
   */
  detail?: string;
  /**
   * Present for an on/off setting. Switches the row to `menuitemcheckbox`,
   * which is the difference between "do this" and "this is on" to a screen
   * reader — and the two are genuinely different rows here.
   */
  checked?: boolean;
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
export function MoreMenu({
  label,
  actions,
  triggerLabel = "•••",
  placement = "below",
  size = "sm",
}: {
  label: string;
  actions: MoreAction[];
  /**
   * What the trigger reads. The glyph is right on a row repeated eighty times,
   * where density is the whole problem and the idiom is universal. In a bar of
   * eight word-labelled verbs it is the odd one out and the least discoverable
   * thing there, so the presenter's bar passes "More". One mechanism, pitched
   * to the density it sits in.
   */
  triggerLabel?: React.ReactNode;
  /** "above" for a bar pinned to the bottom of the viewport. */
  placement?: "below" | "above";
  /** Match the row it sits in: the deck list is sm, the control bar is md. */
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onDown(e: PointerEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    // Capture: a menu item's own click must still land, but a click on
    // anything else must close this before that thing acts on it.
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // Escape and the arrows, shared with every other popup in the product
  // (lib/arrowFocus.ts). ARIA's menu pattern specifies arrow navigation for
  // `role="menu"`: a menu you can only Tab through is not a menu to anyone not
  // using a mouse, whatever it looks like.
  const dismiss = useCallback(() => {
    setOpen(false);
    // Focus goes back where it came from. Without this, Escape leaves focus on
    // a node that has just been removed and the browser drops it to <body> —
    // so the next Tab restarts at the top of the page, which from a row twelve
    // decks down is a worse place than where they started.
    trigger.current?.focus();
  }, []);
  useArrowFocus(panel, { selector: "[role^='menuitem']", onEscape: open ? dismiss : undefined });

  // Opening puts you on the first row. Required for the keyboard path to work
  // at all — arrows move focus, so something has to be focused first — and
  // harmless for the mouse path, which is how every native menu behaves.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("[role^='menuitem']")?.focus();
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
        onKeyDown={(e) => {
          // Down from a closed trigger opens AND enters, which is what the
          // ARIA pattern specifies and what every native menu does. Without
          // it, opening by keyboard leaves focus on the trigger and the first
          // Down is swallowed getting into the list.
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        title={label}
        className={cn(
          "inline-flex items-center justify-center font-ui font-semibold press select-none",
          "transition-colors duration-fast",
          size === "md" ? "h-11 px-5 text-subhead rounded-md" : "h-9 px-3.5 text-footnote rounded-sm",
          open ? "bg-surface-2 text-ink" : "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-1"
        )}
      >
        <span aria-hidden="true">{triggerLabel}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panel}
            role="menu"
            initial={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.98 }}
            transition={{ duration: dur.fast, ease: ease.standard }}
            // Anchored to the trigger's right edge, so it opens where the
            // finger already is (Fitts) and never covers the row it belongs
            // to. A bar pinned to the bottom of the viewport opens upward for
            // the same reason: downward would be off-screen.
            className={cn(
              "absolute right-0 z-30 min-w-[13rem] p-1 rounded-md bg-surface-2 shadow-elev-2",
              placement === "above"
                ? "bottom-full mb-1.5 origin-bottom-right"
                : "top-full mt-1.5 origin-top-right"
            )}
          >
            {actions.map((a) => (
              <button
                key={a.label}
                role={a.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={a.checked}
                type="button"
                onClick={() => {
                  // A toggle stays open: flipping sound off and the stage
                  // theme after it is one errand, and closing between them
                  // would make the host re-open the same menu to finish it.
                  // An action closes, because it has taken them somewhere.
                  if (a.checked === undefined) setOpen(false);
                  a.onSelect();
                }}
                className={cn(
                  "w-full flex items-center gap-4 text-left px-3 h-9 rounded-xs text-subhead font-medium",
                  "transition-colors duration-fast outline-none focus-visible:shadow-focus",
                  a.danger
                    ? "text-danger hover:bg-[color-mix(in_oklch,var(--danger),transparent_88%)]"
                    : "text-ink-muted hover:text-ink hover:bg-surface-3"
                )}
              >
                <span className="flex-1 min-w-0 truncate">{a.label}</span>
                {a.detail && (
                  <span className="shrink-0 text-footnote text-ink-subtle">{a.detail}</span>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
