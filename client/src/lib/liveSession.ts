// A trail back to a room that is still live.
//
// The session itself already survives the host leaving `/present/:id` — the
// server holds it and `presenter:resume-session` re-attaches on return, which
// is why a host reload does not strand the room. What did NOT survive was the
// host's *knowledge* that it was still there. Nothing in the editor or the
// dashboard could see a live room, so the only trail back was the browser's
// Back button: invisible in fullscreen, gone after a reload, and meaningless
// to anyone who arrived at the editor from somewhere else. The resumable
// session existed; the door to it did not.
//
// So the presenter drops a breadcrumb whenever it adopts a session, and picks
// it up when the host ends one. It is a hint, never the truth: callers
// re-check it against the server (`api.listSessions`) before showing a host
// "your room is live", because a crumb can outlive the room it points at.
//
// sessionStorage, not localStorage, on purpose. The crumb describes *this
// tab's* visit. A second window presenting a different deck must not inherit
// it, and a crumb left behind by last week's browser session must not greet a
// host on Monday with a room that died on Friday.

const KEY = "menti_presenting";

export interface LiveCrumb {
  deckId: string;
  joinCode: string;
  /** When the crumb was written, so a caller can age it out without a fetch. */
  at: number;
}

export function markPresenting(deckId: string, joinCode: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ deckId, joinCode, at: Date.now() }));
  } catch {
    // Private mode quota. Costs us the banner, nothing more — the room is
    // still resumable by navigating to /present/:id, which is what the
    // banner would have done for them.
  }
}

export function clearPresenting(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* see markPresenting */
  }
}

/** The crumb for `deckId`, or null if there isn't one (or it isn't this deck). */
export function getPresenting(deckId?: string): LiveCrumb | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const crumb = JSON.parse(raw) as LiveCrumb;
    if (!crumb?.deckId || !crumb?.joinCode) return null;
    if (deckId && crumb.deckId !== deckId) return null;
    return crumb;
  } catch {
    return null;
  }
}

// ── The run that just finished ───────────────────────────────────────────
//
// Ending a session gave the host four doors on the final screen (FLOW.md F6),
// and the moment they took any of them those doors were gone: getting back to
// the results they had just been looking at meant finding the deck in a list
// of eighty, opening its history, and downloading from there.
//
// There is no bulk "recent sessions" endpoint and the server is not ours to
// change, so asking the API which deck ran last would mean one request per
// deck. The host's own browser already knows — it was driving the session —
// so the answer is remembered rather than re-derived.
//
// Same tab scope and same honesty rule as the live crumb above: this is a
// pointer, and the pages that use it still link to real, authenticated
// endpoints rather than trusting anything cached here.

const LAST_KEY = "menti_last_run";

export interface LastRun {
  deckId: string;
  sessionId: string;
  joinCode: string;
  at: number;
}

export function markRunFinished(deckId: string, sessionId: string, joinCode: string): void {
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify({ deckId, sessionId, joinCode, at: Date.now() }));
  } catch {
    /* see markPresenting */
  }
}

export function getLastRun(): LastRun | null {
  try {
    const raw = sessionStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as LastRun;
    return r?.deckId && r?.sessionId ? r : null;
  } catch {
    return null;
  }
}

export function clearLastRun(): void {
  try {
    sessionStorage.removeItem(LAST_KEY);
  } catch {
    /* see markPresenting */
  }
}
