import { useEffect, type RefObject } from "react";

// Where you were on a page you are coming back to.
//
// FLOW.md F3: a place you return to looks the way you left it. The editor
// remembers its selected slide, but every list in the presenter — decks,
// templates, session history — scrolled back to the top on every return,
// because React Router's HashRouter has no scroll restoration and the browser's
// own is defeated by a client-rendered list that does not exist yet when the
// restore would fire.
//
// On a host with eighty decks that is a scan and a scroll each time, to reach
// a row they were looking at four seconds earlier. The cost is small and it is
// paid on every single navigation, which is the shape of defect that makes a
// product feel like it is not paying attention.
//
// sessionStorage, keyed per page, for the same reason as the other two
// memories here: it describes this tab's visit, not a permanent property of
// the account.
const KEY = "menti_scroll";

function read(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

/**
 * Restore the window's scroll for `key` once `ready` turns true, and keep it
 * recorded while the page is open.
 *
 * `ready` is load-bearing, not a convenience: a restore that fires before the
 * list has rendered scrolls a 600px-tall page to offset 2400 and silently
 * lands at the bottom, which looks exactly like "it forgot" — the bug it was
 * added to fix.
 *
 * `restore` turns the restore off while still recording. Returning to where
 * you were is right when you are RETURNING; it is wrong when the page has
 * something to tell you. A host who has just ended a session lands on the deck
 * list with "You just ran …" at the top of it — and was scrolled eleven
 * hundred pixels past it, to the row they happened to be looking at before
 * they presented. Arriving with news is not the same arrival.
 */
export function useScrollMemory(key: string, ready: boolean, restore = true): void {
  useEffect(() => {
    if (!ready) return;
    const y = restore ? read()[key] : undefined;
    if (typeof y === "number" && y > 0) {
      // After paint. The content exists by `ready`, but its height is only
      // final once the browser has laid it out.
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior }));
    }

    // Recorded continuously rather than on unmount: a hard navigation (the
    // wordmark, a reload, closing the tab) never runs a cleanup, and those are
    // exactly the exits a person takes without thinking about it.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [key]: window.scrollY }));
        } catch {
          /* private-mode quota; costs the restore, nothing else */
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key, ready, restore]);
}

// ── A scrolling pane, per item inside it ─────────────────────────────────
//
// The editor's form pane is the one place in the product where F3 was still
// only half kept: the rail remembered which slide you were on, and every list
// remembered where you were in it, but coming back to a long slide form put
// you at the top of it. A half-kept promise is worse than an unmade one,
// because it teaches people the product remembers and then catches them out.
//
// Keyed per slide rather than per pane, which also makes moving BETWEEN slides
// behave: slide 6 opens at the top the first time you see it, and returns to
// your notes the second time. A pane-level memory would have done the opposite
// of what you want in both cases — dropping you into the middle of a form you
// have never read.
//
// Scoped to one deck at a time. You edit one deck at a time, and bounding it
// this way means the record cannot grow by one entry per slide per deck for as
// long as the tab is open.

const PANE_KEY = "menti_pane_scroll";

function readPane(deckId: string): Record<string, number> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PANE_KEY) || "{}");
    return raw?.deckId === deckId ? (raw.slides ?? {}) : {};
  } catch {
    return {};
  }
}

/**
 * Remember `el`'s scroll position against `itemKey`, and restore it whenever
 * `itemKey` changes.
 *
 * Always sets a position — the stored one, or 0. Leaving it alone for an item
 * with no stored position would strand the reader halfway down a form they
 * have never opened, which is the failure this is meant to prevent, pointed
 * the other way.
 */
export function usePaneScrollMemory(
  ref: RefObject<HTMLElement | null>,
  deckId: string | undefined,
  itemKey: string | null
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !deckId || !itemKey) return;

    // After paint: the pane's content is swapped by a keyed remount, so its
    // height is only final once the new form has laid out.
    const raf = requestAnimationFrame(() => {
      el.scrollTop = readPane(deckId)[itemKey] ?? 0;
    });

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          sessionStorage.setItem(
            PANE_KEY,
            JSON.stringify({ deckId, slides: { ...readPane(deckId), [itemKey]: el.scrollTop } })
          );
        } catch {
          /* private-mode quota; costs the restore, nothing else */
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, deckId, itemKey]);
}
