// The two pieces of clock arithmetic a live session depends on, and the one
// bound that guards the second.
//
// Both were inline in `sockets/session.ts`, which is 2700 lines and reachable
// only through a socket handler holding a database connection — so neither
// could be tested, and both are the kind of arithmetic that is wrong silently.
// Pulled out here for the same reason `timeScale.ts` was: one answer to each
// question, in a file a test can import without standing up a server.

/**
 * How long after a question closes a still-arriving answer is still taken.
 *
 * Sized to cover delivery, not deliberation: a round trip on a congested venue
 * network, not a player thinking past the buzzer. The reveal fires at exactly
 * `startedAt + limit`, so without this an answer tapped at 19.9s on a 20s
 * question and delivered at 20.1s was thrown away — indistinguishable, to the
 * person it happened to, from the app losing their answer.
 */
export const NETWORK_GRACE_MS = Number(process.env.NETWORK_GRACE_MS ?? 750);

/**
 * May an answer that arrived at `arrivedMono` still be taken for a question
 * that closed at `closedAtMono`?
 *
 * Both on the monotonic clock, and both measured by the SERVER — the client
 * contributes nothing, so holding an answer back to think past the buzzer
 * still misses, because the window is measured from the close rather than from
 * anything the phone claims about itself.
 *
 * `undefined` means we have no record of when the question closed, which is the
 * rehydrate case: it closed before this process existed. That earns no grace.
 * Treating "I do not know when it closed" as "it closed long ago" is the only
 * direction that cannot reopen a settled question.
 */
export function withinNetworkGrace(
  arrivedMono: number,
  closedAtMono: number | undefined,
  graceMs: number = NETWORK_GRACE_MS
): boolean {
  if (closedAtMono === undefined) return false;
  const late = arrivedMono - closedAtMono;
  // A frame that arrived BEFORE the close is not late at all. It should not
  // have reached this test, but reading a negative as "in grace" is both true
  // and the safe answer if it ever does.
  return late <= graceMs;
}

/**
 * A stored wall-clock instant, placed on THIS process's monotonic scale.
 *
 * Monotonic time counts from the moment a process started, so it means nothing
 * across a restart and cannot be stored. Wall clock survives but can step. The
 * live session therefore keeps both and converts at the boundary: a row's
 * `arrivedAt` (or a session's `currentSlideStartedAt`) is walked back onto the
 * monotonic scale by however long ago it was.
 *
 * Clamped at zero elapsed, so a row stamped in the FUTURE — a clock step
 * between two processes — reads as "just now" rather than as a negative
 * elapsed, which would hand its owner more than a full scoring window.
 */
export function monoFromWall(
  storedWall: number,
  nowWall: number,
  nowMono: number
): number {
  return nowMono - Math.max(0, nowWall - storedWall);
}
