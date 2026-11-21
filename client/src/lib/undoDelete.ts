import { useCallback, useEffect, useRef, useState } from "react";

// Deleting something, with a way back.
//
// Both deletions in this product were guarded by `window.confirm()`: a native
// modal, rendered at OS size in OS styling, that interrupts you to ask whether
// you meant the thing you just clicked — and then destroys it with no recourse.
// NN/g are blunt about which way round this should be: a confirmation taxes
// every correct action to catch the rare wrong one, while an undo taxes
// nothing and catches all of them.
//
// There is no restore endpoint, and rebuilding a deck from whatever the client
// still held in memory would be a different deck. So the undo is real rather
// than compensating: the destroy is DEFERRED. The row leaves the screen at
// once — that part should feel instant, and it is what makes the action feel
// taken — while the request that cannot be reversed waits out a short window.
// Undo inside that window means the server is never told at all.
//
// The window is the whole design, so the two ways to leave it early both have
// to be handled or this trades a confirm for a far worse bug: an item that
// comes back from the dead on the next load.
//
//   1. Navigating away or unmounting — flushed synchronously.
//   2. Closing the tab — flushed on `pagehide`, which unlike `beforeunload`
//      fires on mobile Safari's bfcache path, where `beforeunload` does not.
//
// Both call the same commit. The cost of a double-commit is nothing (the row
// is already gone and the second DELETE 404s); the cost of a missed one is the
// user watching a deck they deleted reappear.

const WINDOW_MS = 6000;

export interface PendingDelete {
  key: string;
  /** What the undo bar says was removed. */
  label: string;
}

export function useUndoableDelete() {
  const [pending, setPending] = useState<PendingDelete | null>(null);
  // The commits still owed, keyed the same as `pending`. A map rather than one
  // slot because two quick deletes must not let the first escape uncommitted:
  // the BAR only ever shows the most recent, but every scheduled destroy is
  // still owed and is still flushed.
  const owed = useRef<Map<string, () => void>>(new Map());
  const timers = useRef<Map<string, number>>(new Map());

  const commit = useCallback((key: string) => {
    const fn = owed.current.get(key);
    owed.current.delete(key);
    const t = timers.current.get(key);
    if (t) window.clearTimeout(t);
    timers.current.delete(key);
    fn?.();
    setPending((p) => (p?.key === key ? null : p));
  }, []);

  const flushAll = useCallback(() => {
    for (const key of [...owed.current.keys()]) commit(key);
  }, [commit]);

  /** Remove it from the screen now; tell the server in `WINDOW_MS` unless undone. */
  const scheduleDelete = useCallback(
    (key: string, label: string, destroy: () => void) => {
      owed.current.set(key, destroy);
      const t = window.setTimeout(() => commit(key), WINDOW_MS);
      timers.current.set(key, t);
      setPending({ key, label });
    },
    [commit]
  );

  /** Called by the undo control. Returns true if the destroy was still owed. */
  const undo = useCallback((key: string): boolean => {
    const had = owed.current.delete(key);
    const t = timers.current.get(key);
    if (t) window.clearTimeout(t);
    timers.current.delete(key);
    setPending((p) => (p?.key === key ? null : p));
    return had;
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", flushAll);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      flushAll();
    };
  }, [flushAll]);

  // `commit` is exposed for a caller whose OWN lifetime is shorter than the
  // hook's: the editor's slide form schedules an option removal and is
  // unmounted when the host switches slides, and that switch must commit the
  // removal the same way leaving the page does — otherwise the row would
  // return on the next visit, which is the bug the window exists to avoid.
  return { pending, scheduleDelete, undo, commit, windowMs: WINDOW_MS };
}
