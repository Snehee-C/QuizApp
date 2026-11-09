import { useEffect, type RefObject } from "react";

/**
 * Arrow keys move focus inside a popup. One implementation, for all of them.
 *
 * This started as private logic inside `SlideNavigator`, and the moment two
 * more popups needed it the choice was between a second and third copy or one
 * mechanism — which is DESIGN.md P1 exactly: harmony is the absence of two
 * ways to say the same thing. Three hand-rolled key handlers would have drifted
 * within a week, and the drift would have been invisible, because nobody
 * notices that Home works in one menu and not another until they need it.
 *
 * It is also a floor rather than a polish item. ARIA's menu pattern specifies
 * arrow navigation for `role="menu"`: a menu you can only Tab through is not a
 * menu to a screen reader or to anyone who does not use a mouse, whatever it
 * looks like.
 *
 * Geometry decides the column count rather than a prop, so the same hook
 * serves a vertical menu (one column, Up/Down) and a reflowing card grid
 * (Up/Down cross a row) without being told which it is — and a grid that
 * reflows at a narrower width keeps working, because the question is asked of
 * the DOM at the moment the key is pressed.
 */
export function useArrowFocus(
  containerRef: RefObject<HTMLElement | null>,
  {
    selector,
    onEscape,
  }: {
    /** What counts as an item. Must match focusable elements. */
    selector: string;
    onEscape?: () => void;
  }
): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const root = containerRef.current;
      if (!root) return;

      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }

      const KEYS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
      if (!KEYS.includes(e.key)) return;

      const items = [...root.querySelectorAll<HTMLElement>(selector)];
      if (items.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const typing =
        !!active &&
        root.contains(active) &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA");

      // In a text field, Left/Right belong to the caret. Taking them would
      // make the filter box in the type picker impossible to edit — the cost
      // of a shared hook is that it has to know where it is standing.
      if (typing && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

      e.preventDefault();

      const at = items.findIndex((el) => el === active);
      if (at === -1) {
        // Focus is outside the item set — the filter box, or nothing at all.
        // Either way the first (or last) item is the right place to land.
        (e.key === "ArrowUp" || e.key === "End" ? items[items.length - 1] : items[0])?.focus();
        return;
      }

      const cols = countColumns(items);
      const step =
        e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols : -cols;
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : Math.min(items.length - 1, Math.max(0, at + step));
      items[next]?.focus();
    }

    // Capture, on window: the presenter's own global handler binds ArrowRight
    // to `presenter:next`, which is a broadcast to every phone in the room.
    // Browsing a popup with the keyboard must never be able to reach it, and
    // being first is a stronger guarantee than the popup's own open-state check.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [containerRef, selector, onEscape]);
}

/** How many items share the first row — the rendered grid's real column count. */
function countColumns(items: HTMLElement[]): number {
  if (items.length === 0) return 1;
  const top = items[0].getBoundingClientRect().top;
  let n = 0;
  for (const el of items) {
    if (Math.abs(el.getBoundingClientRect().top - top) > 1) break;
    n++;
  }
  return Math.max(1, n);
}
