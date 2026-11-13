/**
 * The server's clock, as seen from a phone whose own clock may be wrong.
 *
 * Every countdown in this app is `startedAt + limit - now`. `startedAt` is the
 * SERVER's wall clock, stamped when the slide went live; `now` used to be
 * `Date.now()`, the PHONE's. Nothing on the wire let the client measure the
 * difference, so the error was undetectable client-side and the ring simply
 * reported the gap between two unrelated clocks.
 *
 * Measured before this existed, on a 20-second question with a phone 60s
 * behind: the ring read "78 seconds left" at t=2s, the player paced themselves
 * against it, and the question closed under them with 58 of those seconds
 * still showing. A phone 90s fast read "0 seconds left" on a 60s question.
 * Grading was never at risk — the server grades on its own monotonic clock —
 * but the countdown is the single affordance a quiz player acts on, and it was
 * sourced from the one clock the server does not control.
 *
 * So every frame that carries `startedAt` now also carries `serverNow`, the
 * server's epoch milliseconds at the moment it emitted, and this module keeps
 * the difference. One number, module-scoped rather than React state: the
 * countdown is read from a requestAnimationFrame loop and from a bare
 * `setTimeout`, neither of which is a render.
 *
 * HONEST WHEN IT KNOWS NOTHING. Against a server that sends no `serverNow` —
 * or before the first frame of a session has landed — the offset is `null` and
 * `serverNow()` is exactly `Date.now()`, which is today's behaviour. We never
 * invent a correction we have not been given.
 */

/**
 * `serverNow - Date.now()`, or `null` while no sample has ever arrived.
 *
 * Latest sample wins rather than an average: the thing being corrected is a
 * step (a phone whose clock is simply set wrong, or gets re-set mid-session by
 * NTP), not noise, and the newest reading is always the most true.
 */
let offsetMs: number | null = null;

/**
 * Record a server timestamp.
 *
 * `rttMs` is the measured round trip, when the caller has one — a reply to an
 * emit we timed. The stamp was written at the far end of that trip, so half of
 * it has already elapsed by the time we read it; without the correction we
 * would place the server slightly in the past and show slightly MORE time left
 * than there is, which is the direction that costs a player the question. For
 * a broadcast there is no trip to measure and the residual error is one-way
 * latency — tens of milliseconds, against the tens of seconds this fixes.
 *
 * Anything that is not a finite number is ignored, so an older server sending
 * no field, or a garbled frame, leaves the phone exactly as it was.
 */
export function noteServerNow(stamp: unknown, rttMs = 0): void {
  if (typeof stamp !== "number" || !Number.isFinite(stamp)) return;
  const half = Number.isFinite(rttMs) && rttMs > 0 ? rttMs / 2 : 0;
  offsetMs = stamp + half - Date.now();
}

/** Epoch milliseconds on the SERVER's clock, as best this phone can tell. */
export function serverNow(): number {
  return Date.now() + (offsetMs ?? 0);
}

/** Has any frame ever told us the server's time? */
export function hasServerClock(): boolean {
  return offsetMs !== null;
}

/** How far this phone's clock is from the server's, in ms. 0 when unknown. */
export function clockOffsetMs(): number {
  return offsetMs ?? 0;
}

/** Test seam. Never called by the app. */
export function resetServerClock(): void {
  offsetMs = null;
}
