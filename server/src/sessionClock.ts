// Clock arithmetic a live session depends on. (It also held a post-reveal
// network grace; that was removed because the reveal hands phones the answer
// key — see "Once revealed, the question is closed" in sockets/session.ts.)
//
// It was inline in `sockets/session.ts`, which is 2700 lines and reachable
// only through a socket handler holding a database connection — so it could
// not be tested, and it is the kind of arithmetic that is wrong silently.
// Pulled out here for the same reason `timeScale.ts` was: one answer to each
// question, in a file a test can import without standing up a server.

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
