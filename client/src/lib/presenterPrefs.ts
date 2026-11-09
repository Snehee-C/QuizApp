// Presenter preferences that belong to the HOST's machine, not to a deck.
//
// The deck owns what the room experiences (theme, pacing, timing) and the
// server stores it. This file owns what the host's own screen does, which no
// one else is affected by and which should survive into their next session
// without being a property of any particular deck — the same split, and the
// same localStorage mechanism, that `lib/theme.ts` already uses for the
// Stage Dark / Stage Light choice.

const REVEAL_KEY = "floodlight_reveal_upcoming";

/**
 * May the slide navigator show questions the room has NOT been shown yet?
 *
 * Defaults to false, which is the safe answer rather than the familiar one.
 * The navigator renders on a projected surface, so a host who opens it to find
 * slide 9 is also showing the room slides 5 through 12 — and for a quiz, those
 * are the questions they are about to be asked. A trivia host running a paid
 * quiz night has a real objection to that and should not have to discover a
 * setting to be protected from it.
 *
 * It is off rather than absent because hiding them costs something too: a host
 * jumping FORWARD needs to know what they are jumping to, and on a single
 * screen the navigator is the only place that can tell them. So the control
 * lives in the panel itself, where the need appears, and the choice persists —
 * flipping it is a one-time cost for the hosts who want it.
 */
export function getRevealUpcoming(): boolean {
  try {
    return localStorage.getItem(REVEAL_KEY) === "1";
  } catch {
    return false;
  }
}

export function setRevealUpcoming(value: boolean): void {
  try {
    localStorage.setItem(REVEAL_KEY, value ? "1" : "0");
  } catch {
    // Private mode. The preference lasts the session instead of outliving it.
  }
}

// ── What the room has actually been shown ────────────────────────────────
//
// Kept by INDEX rather than slide id, because the index is the only identity
// the presenter is given: the session ack carries `slideTitles` (strings) and
// `slide:changed` carries a position. There is no index→id map to build from.
//
// That is safe only because an index is meaningful exactly as long as the
// deck's length is, and the presenter already watches for that: when
// `totalSlides` stops matching the title array, the snapshot was reconciled
// under us and both the titles and this set are discarded together. One
// staleness signal, applied to both things that depend on it.
//
// Keyed by join code and in sessionStorage so a host reload does not forget.
// The resume path restores everything else about a live session; without this
// a refresh would re-classify twenty minutes of already-asked questions as
// secrets. Session-scoped rather than deck-scoped: a second run of the same
// deck is a new audience, and what the last room saw says nothing about this
// one.

const SHOWN_KEY = "floodlight_shown_slides";

function readShown(): Record<string, number[]> {
  try {
    return JSON.parse(sessionStorage.getItem(SHOWN_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getShownSlides(joinCode: string | null): Set<number> {
  if (!joinCode) return new Set();
  return new Set(readShown()[joinCode] ?? []);
}

export function saveShownSlides(joinCode: string | null, shown: Set<number>): void {
  if (!joinCode) return;
  try {
    // Only this room's list is kept. A browser left open across a day of
    // sessions would otherwise accumulate one entry per room forever.
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify({ [joinCode]: [...shown] }));
  } catch {
    // Private mode: the set lives in memory for this page's life, which is the
    // common case anyway — it only matters across a reload.
  }
}
