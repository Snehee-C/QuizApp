import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { cn } from "../../lib/cn";
import { duration as dur, ease, prefersReducedMotion } from "../../lib/motion";

/**
 * Every key the presenter answers to, on one sheet, behind `?`.
 *
 * The keys existed before the sheet did, which meant a host learned them from
 * the button tooltips or not at all. A clicker-driven activity whose shortcuts
 * are undiscoverable is one a host drives with the mouse, from the lectern,
 * facing away from the room.
 *
 * Lives inside the control bar's <footer> for the reason SlideNavigator.tsx
 * gives at length: desk-distance host chrome, AA target, never projected at
 * stage size. Rendered as a dialog rather than a MoreMenu row so it can be a
 * two-column table — a menu row cannot hold a key and a verb side by side.
 */
const SHORTCUTS: { keys: string[]; does: string }[] = [
  { keys: ["→", "Space", "PgDn"], does: "Next slide — or Start, from the lobby" },
  { keys: ["←", "PgUp"], does: "Previous slide" },
  { keys: ["Home", "End"], does: "First / last slide" },
  { keys: ["g"], does: "Go to any slide" },
  { keys: ["l"], does: "Standings on / off" },
  { keys: ["b"], does: "Blank the screen (black)" },
  { keys: ["w"], does: "Blank the screen (white)" },
  { keys: ["Esc"], does: "Unblank, or close a panel" },
  { keys: ["f"], does: "Fullscreen" },
  { keys: ["?"], does: "This sheet" },
];

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const reduced = prefersReducedMotion();

  // Focus moves into the sheet so Escape is heard by it and Tab does not
  // wander back onto the bar underneath.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <>
      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: dur.fast }}
        onClick={onClose}
        // `absolute … h-screen`, not `fixed`: the footer animates a transform
        // (SlideNavigator.tsx explains the containing-block trap).
        className="absolute inset-x-0 bottom-0 h-screen z-40"
        style={{ background: "color-mix(in oklch, var(--canvas), transparent 16%)" }}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        initial={{ opacity: 0, y: reduced ? 0 : 14, scale: reduced ? 1 : 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.99 }}
        transition={{ duration: dur.slow, ease: ease.standard }}
        className={cn(
          "absolute bottom-full inset-x-0 mx-auto mb-3 z-50 outline-none",
          "w-[min(78vw,34rem)] max-h-[58vh] overflow-y-auto",
          "rounded-xl bg-surface-1 shadow-elev-3 p-5"
        )}
      >
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="text-caption2 font-semibold uppercase track-label text-ink-subtle">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 px-3 h-8 rounded-sm text-footnote font-semibold bg-surface-2 text-ink-muted hover:text-ink hover:bg-surface-3 press"
          >
            Close
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 items-baseline">
          {SHORTCUTS.map((s) => (
            <div key={s.does} className="contents">
              <dt className="flex gap-1.5">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="nums inline-flex items-center h-7 px-2 rounded-xs bg-surface-2 shadow-line text-footnote font-semibold text-ink"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-subhead text-ink-muted m-0">{s.does}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-footnote text-ink-subtle">
          Keys with ⌘, Ctrl or Alt held are left to the browser and never reach the room.
        </p>
      </motion.div>
    </>
  );
}
