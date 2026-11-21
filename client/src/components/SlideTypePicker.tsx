import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "../lib/cn";
import { SLIDE_GROUPS, typesInGroup } from "../slides/registry";
import { duration as dur, ease, prefersReducedMotion } from "../lib/motion";
import { useArrowFocus } from "../lib/arrowFocus";
import { Input } from "./ui/Card";
import { Dismiss } from "./ui/Dismiss";

/**
 * Choosing what kind of slide to add.
 *
 * The editor's rail used to carry all seventeen types, expanded, permanently,
 * under three headings — a wall of equal-weight choices that a first-run host
 * met before they had written a single question, and that pushed the actual
 * slide list up the rail on every deck. Hick's Law is the textbook objection,
 * but the specific damage was narrower than "too many options": nothing
 * recommended anything. Seventeen peers with no suggested path is not a menu,
 * it is a quiz about the product.
 *
 * So the list moved behind one deliberate press, where it can afford to be
 * better than a list: grouped, with every type's one-line hint visible instead
 * of hidden in a `title` attribute nobody hovers.
 *
 * The filter exists to pay back what disclosure costs. Hiding the types turns
 * a one-press add into a two-press add for an author who already knows what
 * they want, and that author is the one using this most. Typing three letters
 * and pressing Enter is faster than either, so the expert comes out ahead
 * rather than taxed.
 */
export function SlideTypePicker({
  onPick,
  onClose,
  placement,
}: {
  onPick: (type: string) => void;
  onClose: () => void;
  /** Where the new slide will land — "After slide 3" — so adding is never a surprise. */
  placement?: string;
}) {
  const [q, setQ] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const reduced = prefersReducedMotion();

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SLIDE_GROUPS.map((g) => ({
      ...g,
      types: typesInGroup(g.key).filter(
        (t) =>
          !needle ||
          t.label.toLowerCase().includes(needle) ||
          t.hint.toLowerCase().includes(needle)
      ),
    })).filter((g) => g.types.length > 0);
  }, [q]);

  // The first match, so Enter means "the obvious one" rather than nothing.
  const first = groups[0]?.types[0]?.type ?? null;

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!panel.current?.contains(e.target as Node)) onClose();
    }
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  // Escape, and arrows across the card grid — the same hook the navigator and
  // the menus use. It leaves Left/Right alone while the filter box has focus,
  // because there they belong to the caret, so Down is the way out of the box
  // and into the cards and typing is never interrupted (lib/arrowFocus.ts).
  useArrowFocus(panel, { selector: "button[data-type]", onEscape: onClose });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-6 py-10">
      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: dur.fast }}
        className="absolute inset-0"
        // color-mix, not `bg-canvas/70`: the slash-alpha cannot add an alpha
        // channel to an oklch() token and silently computes to transparent.
        style={{ background: "color-mix(in oklch, var(--canvas), transparent 20%)" }}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Add a slide"
        initial={{ opacity: 0, y: reduced ? 0 : 16, scale: reduced ? 1 : 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: reduced ? 1 : 0.99 }}
        transition={{ duration: dur.slow, ease: ease.standard }}
        className="relative w-full max-w-3xl max-h-full overflow-y-auto rounded-xl bg-surface-1 shadow-elev-3 p-6"
      >
        {/* The ✕ is a visible way out (UX-PLAN 5.9): Escape and the scrim
            both work and neither is discoverable from inside a dialog. */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h2 className="font-display text-title2 font-bold">Add a slide</h2>
            {placement && (
              <p className="text-footnote text-ink-subtle mt-0.5">{placement}</p>
            )}
          </div>
          <Dismiss onClick={onClose} label="Close" className="-mt-2 -mr-2 shrink-0" />
        </div>

        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && first) {
              e.preventDefault();
              onPick(first);
            }
          }}
          placeholder="Filter — word cloud, quiz, ranking…"
          aria-label="Filter slide types"
          className="mb-5"
        />

        {groups.length === 0 && (
          <p className="text-ink-subtle text-subhead py-6 text-center">
            Nothing matches “{q.trim()}”.
          </p>
        )}

        {groups.map((g) => (
          <section key={g.key} className="mb-5 last:mb-0">
            <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle mb-2">
              {g.label}
            </p>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
              {g.types.map((t) => {
                // Enter in the filter adds `first`. That used to be a fact
                // nobody could see — an empty filter plus Enter silently
                // added Multiple choice — so the card Enter would pick wears
                // the focus ring and says so, and it moves as the filter
                // narrows (UX-PLAN 5.9).
                const isFirst = t.type === first;
                return (
                  <button
                    key={t.type}
                    type="button"
                    data-type={t.type}
                    data-enter-target={isFirst || undefined}
                    onClick={() => onPick(t.type)}
                    className={cn(
                      "relative text-left px-4 py-3 rounded-md bg-surface-2 outline-none",
                      "hover:bg-surface-3 transition-[background-color,box-shadow] duration-fast focus-visible:shadow-focus",
                      isFirst && "shadow-focus"
                    )}
                  >
                    <span className="block text-subhead font-semibold text-ink pr-14">{t.label}</span>
                    {/* The hint was always written; it just lived in a `title`
                        attribute, which is to say it was written for nobody. */}
                    <span className="block text-caption text-ink-subtle mt-0.5">{t.hint}</span>
                    {isFirst && (
                      <span
                        className="absolute top-2.5 right-3 text-caption2 font-semibold uppercase track-label text-accent"
                        aria-hidden="true"
                      >
                        ↵ Enter
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </motion.div>
    </div>
  );
}
