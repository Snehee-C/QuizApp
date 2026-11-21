import { useSyncExternalStore } from "react";

// The editor's one save pipeline (PULSE.md T2; UX-PLAN 5.1).
//
// Before this, every write in the editor was fire-and-forget: `save()` fired
// a PATCH from `onChange` with no catch, `renameTitle` issued one PUT per
// keystroke, and `api.request()` throws on any non-2xx — so a failed write
// became an unhandled rejection while the form went on rendering the edit as
// applied. Silence was the only answer the editor had, and silence is never
// an answer.
//
// This module is deliberately NOT a React hook. It is a singleton the editor
// writes into, for two reasons:
//
//   1. A pending edit must survive the editor unmounting. A host who types a
//      correction and presses "Back to the room" inside the debounce window
//      has not changed their mind about the correction; the write goes out
//      from here whether or not the form that produced it still exists.
//   2. The header indicator and the `beforeunload` guard need the same answer
//      to "is anything unsaved" that the pipeline itself has, not a second
//      copy of it kept in component state.
//
// Per key (`slide:<id>`, `deck:<id>`, `order:<id>`):
//   - patches COALESCE: `{question}` then `{config}` inside the window go out
//     as one PATCH, and ten keystrokes go out as one, not ten;
//   - writes are SEQUENTIAL: never two in flight for the same key, so a slow
//     first PATCH can never land after a fast second one and revert it;
//   - failure RETRIES with backoff, and retries at once when the browser
//     reports it is back online. A failed write is merged back under whatever
//     arrived since, so nothing typed during the outage is lost.
//
// The debounce has a ceiling. Trailing-only would mean a host typing a long
// question steadily never persists it until they pause; with a max wait the
// pipeline writes every couple of seconds regardless, so the most that can be
// lost to a crash mid-sentence is two seconds of typing.

const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 2000;
const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 15000;

type Patch = Record<string, unknown>;
type Writer = (patch: Patch) => Promise<unknown>;

interface Entry {
  writer: Writer;
  onAck?: (result: unknown) => void;
  /** Merged, not yet sent. */
  pending: Patch | null;
  /** On the wire right now. */
  inFlight: Patch | null;
  debounce: number | null;
  /** When `pending` first became non-empty — the max-wait clock. */
  dirtySince: number | null;
  attempt: number;
  retry: number | null;
  failed: boolean;
}

export interface AutosaveState {
  /** Anything pending, in flight, or failed. The `beforeunload` guard reads this. */
  dirty: boolean;
  /** When the oldest unacknowledged edit was made; null when clean. */
  dirtySince: number | null;
  /** At least one write has failed and is waiting to retry. */
  failed: boolean;
  /** `navigator.onLine`, tracked so the indicator can say WHY it is retrying. */
  online: boolean;
  /** Last successful acknowledgement, any key. Null until one lands. */
  lastSavedAt: number | null;
  /**
   * A one-shot failure from something that is not a patch — adding or
   * deleting a slide — which has no retry and therefore needs saying once.
   */
  notice: { id: number; message: string } | null;
}

const entries = new Map<string, Entry>();
// Pending removals and other edits that are held back deliberately (an undo
// window) count as unsaved for the leave guard, but are not the pipeline's
// to send yet. See Editor.tsx's option removal.
const holds = new Set<string>();
const listeners = new Set<() => void>();

let state: AutosaveState = {
  dirty: false,
  dirtySince: null,
  failed: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  lastSavedAt: null,
  notice: null,
};

function publish() {
  let dirty = holds.size > 0;
  let dirtySince: number | null = null;
  let failed = false;
  for (const e of entries.values()) {
    if (e.pending || e.inFlight || e.failed) dirty = true;
    if (e.failed) failed = true;
    if (e.dirtySince !== null && (dirtySince === null || e.dirtySince < dirtySince)) {
      dirtySince = e.dirtySince;
    }
  }
  state = { ...state, dirty, dirtySince, failed };
  for (const l of listeners) l();
}

function entry(key: string, writer: Writer, onAck?: (r: unknown) => void): Entry {
  let e = entries.get(key);
  if (!e) {
    e = {
      writer,
      onAck,
      pending: null,
      inFlight: null,
      debounce: null,
      dirtySince: null,
      attempt: 0,
      retry: null,
      failed: false,
    };
    entries.set(key, e);
  }
  // The latest closure wins: it is the one holding the current callbacks.
  e.writer = writer;
  e.onAck = onAck;
  return e;
}

function send(key: string) {
  const e = entries.get(key);
  if (!e || e.inFlight || !e.pending) return;
  if (e.debounce !== null) window.clearTimeout(e.debounce);
  e.debounce = null;
  if (e.retry !== null) window.clearTimeout(e.retry);
  e.retry = null;

  const patch = e.pending;
  e.pending = null;
  e.inFlight = patch;
  publish();

  e.writer(patch).then(
    (result) => {
      e.inFlight = null;
      e.failed = false;
      e.attempt = 0;
      state = { ...state, lastSavedAt: Date.now() };
      if (!e.pending) e.dirtySince = null;
      publish();
      e.onAck?.(result);
      // Whatever arrived while this was on the wire goes next, at once —
      // it has already waited its turn.
      if (e.pending) send(key);
    },
    () => {
      // Back under the newer edits: a field changed since the failed attempt
      // keeps its newer value, everything else is restored for the retry.
      e.pending = { ...patch, ...(e.pending ?? {}) };
      e.inFlight = null;
      e.failed = true;
      const wait = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** e.attempt);
      e.attempt += 1;
      e.retry = window.setTimeout(() => send(key), wait);
      publish();
    }
  );
}

export const autosave = {
  /**
   * Queue a partial write. Patches to the same key are merged and sent as one
   * request once typing pauses; the writer receives the merged patch.
   */
  patch(key: string, patch: Patch, writer: Writer, onAck?: (result: unknown) => void) {
    const e = entry(key, writer, onAck);
    const now = Date.now();
    if (e.dirtySince === null) e.dirtySince = now;
    e.pending = { ...(e.pending ?? {}), ...patch };
    if (e.debounce !== null) window.clearTimeout(e.debounce);
    // A write that is waiting to retry has already been coalesced; the retry
    // timer owns it. A fresh edit in that state goes out with the retry.
    if (e.retry !== null) {
      publish();
      return;
    }
    const waited = now - e.dirtySince;
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited));
    e.debounce = window.setTimeout(() => send(key), delay);
    publish();
  },

  /**
   * The fields of `key` the server may not hold yet: what is on the wire plus
   * what is still coalescing. A fresh GET that lands while either is non-empty
   * carries the pre-edit values for exactly these fields, and applying it
   * verbatim would revert an edit the host watched get "Saved" a moment
   * later. The loader overlays this on top of what it fetched.
   */
  unsaved(key: string): Patch | null {
    const e = entries.get(key);
    if (!e) return null;
    if (!e.inFlight && !e.pending) return null;
    return { ...(e.inFlight ?? {}), ...(e.pending ?? {}) };
  },

  /** Send everything pending now, skipping the debounce. */
  flush(prefix?: string) {
    for (const key of entries.keys()) {
      if (prefix && !key.startsWith(prefix)) continue;
      send(key);
    }
  },

  /** Count an edit held outside the pipeline (an undo window) as unsaved. */
  hold(token: string) {
    holds.add(token);
    publish();
  },
  release(token: string) {
    holds.delete(token);
    publish();
  },

  /** Say once that a one-shot operation failed. */
  notify(message: string) {
    state = { ...state, notice: { id: Date.now(), message } };
    publish();
  },
  clearNotice(id: number) {
    if (state.notice?.id === id) {
      state = { ...state, notice: null };
      publish();
    }
  },

  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    state = { ...state, online: true };
    // Retry at once rather than waiting out the backoff: the thing we were
    // waiting for has happened.
    for (const [key, e] of entries) {
      if (e.failed && e.pending && !e.inFlight) send(key);
    }
    publish();
  });
  window.addEventListener("offline", () => {
    state = { ...state, online: false };
    publish();
  });
  // Not a substitute for the leave guard (a fetch started here may be
  // cancelled by the unload), but the best attempt available on the path
  // where `beforeunload` never fires: mobile Safari's bfcache.
  window.addEventListener("pagehide", () => autosave.flush());
}

export function useAutosaveState(): AutosaveState {
  return useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState);
}
