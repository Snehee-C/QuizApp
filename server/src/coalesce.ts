// A leading-edge throttle with one trailing frame, keyed by room.
//
// The shape `sendLeaderboardToPresenter` already has, lifted out so a second
// per-submission broadcast could share it rather than grow a second copy. The
// first push in a burst goes out immediately — the first answer must be seen
// the moment it lands — and everything inside the window collapses into one
// trailing push carrying whatever was handed over LAST. A payload is a
// description of "now", so an older one is never worth sending.
//
// `now` and `schedule` are injectable so the arithmetic can be tested without
// a real clock; production callers pass nothing.

export interface Throttle<T> {
  /** Send now if the window is open; otherwise keep `payload` for the trailing frame. */
  push(key: string, payload: T): void;
  /** Drop anything pending for `key` — the room is gone. */
  cancel(key: string): void;
}

interface State<T> {
  lastAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  pending: T | null;
}

export function createThrottle<T>(
  windowMs: number,
  send: (key: string, payload: T) => void,
  deps: {
    now?: () => number;
    schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clear?: (t: ReturnType<typeof setTimeout>) => void;
  } = {}
): Throttle<T> {
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? setTimeout;
  const clear = deps.clear ?? clearTimeout;
  const states = new Map<string, State<T>>();

  return {
    push(key, payload) {
      let st = states.get(key);
      if (!st) {
        st = { lastAt: -Infinity, timer: null, pending: null };
        states.set(key, st);
      }
      const t = now();
      if (t - st.lastAt >= windowMs) {
        if (st.timer) clear(st.timer);
        st.timer = null;
        st.pending = null;
        st.lastAt = t;
        send(key, payload);
        return;
      }
      st.pending = payload;
      if (!st.timer) {
        st.timer = schedule(() => {
          const cur = states.get(key);
          if (!cur) return;
          cur.timer = null;
          const queued = cur.pending;
          cur.pending = null;
          if (queued === null) return;
          cur.lastAt = now();
          send(key, queued);
        }, windowMs - (t - st.lastAt));
      }
    },
    cancel(key) {
      const st = states.get(key);
      if (st?.timer) clear(st.timer);
      states.delete(key);
    },
  };
}
