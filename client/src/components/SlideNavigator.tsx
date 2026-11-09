import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { cn } from "../lib/cn";
import { duration as dur, ease, prefersReducedMotion } from "../lib/motion";

/**
 * Go to slide 9 of 20.
 *
 * Before this the presenter could only step ±1, so reaching slide 9 from slide
 * 1 cost eight presses — and `presenter:next` is a BROADCAST. Those eight
 * presses were not merely slow: each one pushed a real `slide:changed` to every
 * phone in the room, restarted the countdown, and flashed a question the room
 * was never meant to see yet. The host paid eight presses and the audience
 * watched the deck shuffle past them.
 *
 * The server has had `presenter:goto` since the beginning — `start()` uses it
 * to open the deck at index 0, and it runs the same validated nav chain as
 * next/prev, including the deleted-slide reconciliation. So a jump is one
 * frame where stepping was N. The transport was never the missing piece; the
 * surface was.
 *
 * ── Why it lives in the control bar's <footer> ───────────────────────────
 * A jump target is a navigation surface, and on this product navigation
 * surfaces are projected. Two things follow.
 *
 * First, it is host chrome, read at desk distance, and it is rendered inside
 * the same <footer> as the control bar so it inherits that classification
 * honestly rather than by exception — DESIGN.md §6 holds the floating bar to
 * AA at desk distance instead of the 24px/7:1 stage floor, and the floor audit
 * encodes that same boundary as `el.closest("footer")`. Putting a desk-distance
 * panel anywhere else would mean either lying to the audit or setting a slide
 * list at 24px.
 *
 * Second: yes, the room can read the upcoming questions while this is open.
 * That is a real cost and it is the smaller one. The alternative it replaces
 * showed those same questions to the room as full-screen slides, one after
 * another, with the clock running on each. A two-second glance at a truncated
 * list is strictly less leakage than actually presenting the slides. It is
 * host-initiated, it dismisses on Escape, on an outside click, and on the jump
 * itself, and the leak-free home for a dual-screen host is the speaker window,
 * which carries the same list.
 *
 * It never renders anything but the question text the stage will show anyway.
 * No config, no options, no correct answers: the answer key does not reach this
 * component and must not be routed into it.
 */
export interface NavigatorSlide {
  /** Zero-based index in the live session, which is what `goto` expects. */
  index: number;
  /** Null when the titles went stale under a mid-session edit (see Present). */
  title: string | null;
}

export function SlideNavigator({
  slides,
  currentIndex,
  onJump,
  onClose,
}: {
  slides: NavigatorSlide[];
  currentIndex: number;
  onJump: (index: number) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const reduced = prefersReducedMotion();

  // Focus the slide you are ON, not the first one. The panel opens as a map of
  // where you are, so the "you are here" pin is the right place to start — and
  // it means Arrow+Enter from the keyboard reaches a neighbour in two presses.
  useEffect(() => {
    const here = panel.current?.querySelector<HTMLButtonElement>("[data-here=true]");
    (here ?? panel.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Arrow keys move focus INSIDE the panel. This is the whole reason the
      // presenter's global key handler is suppressed while the navigator is
      // open: ArrowRight there is `presenter:next`, so browsing the map with
      // the keyboard would have advanced the live room behind the panel.
      const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      const btns = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button[data-slide]") ?? [])];
      if (btns.length === 0) return;
      const at = btns.findIndex((b) => b === document.activeElement);
      // Column count is read from the rendered grid rather than assumed, so
      // Up/Down keep working when the panel reflows at a different width.
      const cols = countColumns(btns);
      const step =
        e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols : -cols;
      const next =
        e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : Math.min(btns.length - 1, Math.max(0, at + step));
      btns[next]?.focus();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // A scrim that is a real element, not a backdrop-filter: this sits over a
  // projected stage, and DESIGN.md §7 budgets backdrop blur to exactly one
  // surface (the control bar) because it costs 15–30% FPS on real machines.
  //
  // It is `absolute … h-screen` rather than `fixed inset-0`, which is what it
  // wanted to be. The control bar is a `motion.footer` that animates `y` to
  // auto-hide, so mid-transition it carries an inline transform — and a
  // transformed ancestor becomes the containing block for `position: fixed`.
  // A fixed scrim would therefore be correctly placed at rest and wrong only
  // while the bar is sliding, which is the worst version of a bug: it would
  // never reproduce when looked at. Anchoring to the footer's own bottom edge
  // and growing a viewport upward does not care what is animating above it.
  //
  // The fill is a `color-mix`, not `bg-canvas/80`. Every colour in this system
  // is an `oklch()` token, and Tailwind's slash-alpha can only inject an alpha
  // channel into a colour it can decompose — given `oklch(0.15 0.012 272)` it
  // emits an invalid value that computes to `rgba(0,0,0,0)`. The scrim was in
  // the right place, the right size and the right z-index, and completely
  // invisible. `color-mix(in oklch, …)` is the spelling the rest of this
  // codebase already uses for exactly this reason (DESIGN.md P1).
  return (
    <>
      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: dur.fast }}
        onClick={onClose}
        className="absolute inset-x-0 bottom-0 h-screen z-40"
        style={{ background: "color-mix(in oklch, var(--canvas), transparent 16%)" }}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Go to slide"
        initial={{ opacity: 0, y: reduced ? 0 : 14, scale: reduced ? 1 : 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.99 }}
        transition={{ duration: dur.slow, ease: ease.standard }}
        // Centred with auto margins, NOT `left-1/2 -translate-x-1/2`: this
        // element's transform belongs to the motion props, and a utility
        // translate on the same element is simply overwritten by them — the
        // panel rendered half a screen to the right until this was margin
        // centring instead.
        className={cn(
          "absolute bottom-full inset-x-0 mx-auto mb-3 z-50",
          "w-[min(78vw,1080px)] max-h-[58vh] overflow-y-auto",
          "rounded-xl bg-surface-1 shadow-elev-3 p-4"
        )}
      >
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
          {slides.map((s) => {
            const here = s.index === currentIndex;
            return (
              <button
                key={s.index}
                type="button"
                data-slide={s.index}
                data-here={here}
                // aria-current is how a screen reader is told which one is on
                // the projector right now; the ring alone is a sighted-only fact.
                aria-current={here ? "true" : undefined}
                onClick={() => onJump(s.index)}
                className={cn(
                  "text-left px-3.5 py-3 rounded-md min-w-0 outline-none",
                  "transition-colors duration-fast focus-visible:shadow-focus",
                  here
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink"
                )}
              >
                {/* Two lines, so two spans — which the stage-floor audit does
                    scan. They are legal only because this panel renders inside
                    the control bar's <footer>, the one surface the audit and
                    DESIGN.md §6 both classify as desk-distance host chrome. If
                    this component is ever moved out of that footer it has to
                    move onto the stage type ladder with it. */}
                <span className={cn("nums text-caption2 font-semibold uppercase track-label block", here ? "text-accent-ink" : "text-ink-subtle")}>
                  Slide {s.index + 1}
                </span>
                <span className="text-subhead font-medium line-clamp-2 block mt-0.5">
                  {s.title || "Untitled"}
                </span>
              </button>
            );
          })}
        </div>
      </motion.div>
    </>
  );
}

/** How many cards share the first row — the grid's real column count. */
function countColumns(btns: HTMLButtonElement[]): number {
  if (btns.length === 0) return 1;
  const top = btns[0].getBoundingClientRect().top;
  let n = 0;
  for (const b of btns) {
    if (Math.abs(b.getBoundingClientRect().top - top) > 1) break;
    n++;
  }
  return Math.max(1, n);
}
