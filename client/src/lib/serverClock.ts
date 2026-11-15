import type { Socket } from "socket.io-client";

/**
 * The server's clock, as seen from a device whose own clock may be wrong.
 *
 * Every countdown in this app is `startedAt + limit - now`. `startedAt` is the
 * SERVER's wall clock, stamped when the slide went live; `now` used to be
 * `Date.now()`, the DEVICE's. Nothing on the wire let the client measure the
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
 * So every frame that carries `startedAt` also carries `serverNow`, the
 * server's epoch milliseconds at the moment it emitted, and this module keeps
 * the difference. One number, module-scoped rather than React state: the
 * countdown is read from a requestAnimationFrame loop and from a bare
 * `setTimeout`, neither of which is a render.
 *
 * HONEST WHEN IT KNOWS NOTHING. Against a server that sends no `serverNow` —
 * or before the first sample of a session has landed — the offset is `null`
 * and `serverNow()` is exactly `Date.now()`. We never invent a correction we
 * have not been given.
 *
 * ── WHY THE FILTER ─────────────────────────────────────────────────────────
 *
 * The first version of this took the latest sample unconditionally, on the
 * reasoning that the thing being corrected is a step (a clock simply set
 * wrong) and the newest reading is always the most true. That is right about
 * steps and wrong about everything else, because a sample is not just the
 * server's time — it is the server's time plus however long the packet spent
 * in a queue on the way here.
 *
 * Two consequences, both observed in a room:
 *
 *   1. A broadcast sample carries no measured trip, so the stamp is already
 *      one-way-latency old when it is read. Uncorrected, that places the
 *      server in the PAST and shows the player MORE time than they have —
 *      the direction that costs them the question.
 *   2. "Latest wins" means the WORST packet wins. One frame delayed two
 *      seconds by a backgrounded tab, a congested venue uplink or a cold
 *      start overwrites a good offset with a two-second-wrong one, and it
 *      stays wrong until the next frame happens to arrive. Two phones on the
 *      same Wi-Fi could sit on offsets seconds apart, which is exactly the
 *      unfairness the shared clock exists to remove.
 *
 * So samples now compete instead of queueing. A sample's RTT is its error
 * bar — the true offset is within ±rtt/2 of what it implies — and the sample
 * that travelled through the least queueing is the most accurate one we have
 * seen, no matter when it arrived. That is the NTP insight, and it is the
 * whole filter: keep the best, not the last.
 *
 * Two things stop "keep the best" from meaning "never move again":
 *
 *   - A STEP. If a new sample disagrees with the held offset by more than
 *     `STEP_THRESHOLD_MS`, no amount of queueing explains it — a clock was
 *     re-set (the phone's by NTP, or the server's). Adopt it immediately and
 *     throw the error bar away. Latency cannot forge a five-second argument,
 *     so this branch cannot be tripped by a slow network.
 *   - DECAY. A held sample's authority erodes with its age, because two
 *     clocks free-running for minutes have drifted apart on their own. The
 *     bar a challenger must clear is `bestRtt` plus `UNMEASURED_RTT_MS` per
 *     `SAMPLE_TTL_MS` of age, so a steady 25 s probe loop always refreshes
 *     (a 30 ms sample clears a held 20 ms one after ~600 ms of ageing) while
 *     an untimed broadcast has to wait out nearly a full minute of measured
 *     silence before it can displace a real measurement.
 *
 * The decay REPLACED a hard "older than a minute, take anything" escape, which
 * re-admitted the exact failure this module exists to prevent: `bestRttMs`
 * only ever ratchets downward, so one lucky 5 ms sample rejected every honest
 * 30 ms probe after it, the held sample went stale on schedule, and the next
 * thing through the door — including a three-second-delayed broadcast — was
 * adopted unconditionally. Measured on that version: −2500 ms of error on a
 * device whose clock was perfect, re-earned about once a minute. An escape
 * hatch that opens on a timer opens for whatever happens to be standing there.
 */

/**
 * The rank an untimed sample competes at. A PENALTY, never a measurement.
 *
 * It was briefly both, and the second job was a mistake: `stamp + rtt/2 - now`
 * with this value substituted for a trip nobody timed invents a 500 ms one-way
 * delay out of nothing. Simulated over ten minutes against a perfect clock,
 * that drifted the offset by up to 460 ms — in the direction that shows a
 * player LESS time than they have, which is the direction that costs them the
 * question. An untimed sample is corrected by zero, because zero is the only
 * honest answer to "how long was it in flight". See `noteServerNow`.
 */
const UNMEASURED_RTT_MS = 1_000;

/** Beyond this, a disagreement is a clock being re-set, not a slow packet. */
const STEP_THRESHOLD_MS = 5_000;

/** The age at which a held sample's bar has risen by `UNMEASURED_RTT_MS`. */
const SAMPLE_TTL_MS = 60_000;

/** Probes per burst. The best of a few costs little and rejects one bad trip. */
const BURST_PROBES = 3;

/** Gap between probes inside a burst — long enough not to share a queue. */
const BURST_SPACING_MS = 120;

/** Between bursts. Cheap enough to be frequent, frequent enough to catch drift. */
const RESYNC_INTERVAL_MS = 25_000;

/** A probe the server never answers must not stall the burst forever. */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * `serverNow - Date.now()`, or `null` while no sample has ever arrived.
 */
let offsetMs: number | null = null;

/** The round trip of the sample `offsetMs` came from — its error bar. */
let bestRttMs = Number.POSITIVE_INFINITY;

/** `Date.now()` when that sample was accepted, for the drift escape. */
let acceptedAt = 0;

/** Samples accepted since load. Diagnostics only; nothing branches on it. */
let acceptedCount = 0;

/**
 * Record a server timestamp.
 *
 * `rttMs` is the measured round trip, when the caller has one — a reply to an
 * emit we timed. The stamp was written at the far end of that trip, so half of
 * it has already elapsed by the time we read it; without the correction we
 * would place the server slightly in the past and show slightly MORE time left
 * than there is, which is the direction that costs a player the question.
 *
 * A caller with no trip to measure (a broadcast) passes none, and the sample
 * is admitted under `UNMEASURED_RTT_MS` — good enough to be the first thing we
 * ever know, never good enough to displace something we actually timed.
 *
 * Anything that is not a finite number is ignored, so an older server sending
 * no field, or a garbled frame, leaves the device exactly as it was.
 */
export function noteServerNow(stamp: unknown, rttMs?: number): void {
  if (typeof stamp !== "number" || !Number.isFinite(stamp)) return;

  const measured = typeof rttMs === "number" && Number.isFinite(rttMs) && rttMs >= 0;
  const now = Date.now();

  // TWO DIFFERENT NUMBERS, deliberately. `rank` is how good we are willing to
  // call this sample when it competes; `half` is how far to shift the stamp
  // for the part of the trip that had already elapsed when we read it. For a
  // timed reply they are the same trip. For an untimed broadcast we know
  // nothing about the trip, so it competes at a penalty and is corrected by
  // nothing — a guessed correction is just error with a confident face on it.
  const rank = measured ? rttMs : UNMEASURED_RTT_MS;
  const half = measured ? rttMs / 2 : 0;
  const candidate = stamp + half - now;

  if (offsetMs === null) return accept(candidate, rank, now);

  // A clock was re-set. No queue is five seconds deep in one direction.
  if (Math.abs(candidate - offsetMs) > STEP_THRESHOLD_MS) {
    return accept(candidate, rank, now);
  }

  // Otherwise it has to clear the held sample's bar, which rises as that
  // sample ages. Ties included, so a steady link keeps refreshing rather than
  // locking onto one lucky early packet.
  if (rank <= barAt(now)) return accept(candidate, rank, now);
}

/**
 * How good a challenger must be to displace what we hold.
 *
 * `bestRttMs` at the instant we accepted it, rising by `UNMEASURED_RTT_MS` for
 * every `SAMPLE_TTL_MS` since. Nothing is ever accepted "because it is time" —
 * a sample still has to be good enough, there is simply a moment for every
 * held sample when good enough stops meaning what it meant.
 */
function barAt(now: number): number {
  return bestRttMs + (now - acceptedAt) * (UNMEASURED_RTT_MS / SAMPLE_TTL_MS);
}

function accept(offset: number, rtt: number, at: number): void {
  offsetMs = offset;
  bestRttMs = rtt;
  acceptedAt = at;
  acceptedCount += 1;
}

/** Epoch milliseconds on the SERVER's clock, as best this device can tell. */
export function serverNow(): number {
  return Date.now() + (offsetMs ?? 0);
}

/** Has any sample ever told us the server's time? */
export function hasServerClock(): boolean {
  return offsetMs !== null;
}

/** How far this device's clock is from the server's, in ms. 0 when unknown. */
export function clockOffsetMs(): number {
  return offsetMs ?? 0;
}

/** Everything the on-screen diagnostic shows. Nothing branches on this. */
export function clockDebug(): {
  synced: boolean;
  offsetMs: number;
  rttMs: number | null;
  ageMs: number | null;
  samples: number;
} {
  return {
    synced: offsetMs !== null,
    offsetMs: offsetMs ?? 0,
    rttMs: Number.isFinite(bestRttMs) ? bestRttMs : null,
    ageMs: acceptedAt ? Date.now() - acceptedAt : null,
    samples: acceptedCount,
  };
}

/**
 * Keep this device's offset measured, for as long as the caller is mounted.
 *
 * Both the phone and the PRESENTER call this. The presenter is the reason it
 * exists as a shared entry point at all: its ring renders from the same
 * `TimerRing`, against the same server `startedAt`, but nothing on the host
 * ever recorded a sample — so `serverNow()` fell through to `Date.now()` and
 * the stage counted down on the laptop's own clock while every phone in the
 * room counted down on the server's. A host machine a few seconds out of true
 * put the projector and the audience on visibly different timers, for the
 * whole session, with no way for anyone present to tell which was right.
 *
 * Bursts rather than single probes, because the filter above chooses between
 * samples and one probe gives it nothing to choose from: three spaced trips
 * cost a few hundred bytes and reliably contain one that missed the queue.
 *
 * Re-bursts on every `connect`, not only on mount — a reconnect is the single
 * most likely moment for the network underneath us to have changed, and a
 * phone that has just come back from a dead spot is the one most likely to be
 * holding a sample measured through a dying link.
 */
export function startClockSync(socket: Socket): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const probe = () =>
    new Promise<void>((resolve) => {
      if (stopped || !socket.connected) return resolve();
      const sentAt = Date.now();
      // `.timeout()` so a server that predates `time:sync` — which never acks
      // at all — cannot leave this promise pending and stall every later
      // burst behind it. On timeout `err` is set and there is no sample,
      // which is the correct outcome: we learn nothing and change nothing.
      socket.timeout(PROBE_TIMEOUT_MS).emit("time:sync", {}, (err: unknown, res: any) => {
        if (!err) noteServerNow(res?.serverNow, Date.now() - sentAt);
        resolve();
      });
    });

  const burst = async () => {
    for (let i = 0; i < BURST_PROBES; i++) {
      if (stopped) return;
      await probe();
      if (i < BURST_PROBES - 1) {
        await new Promise((r) => setTimeout(r, BURST_SPACING_MS));
      }
    }
  };

  const loop = async () => {
    await burst();
    if (stopped) return;
    timer = setTimeout(loop, RESYNC_INTERVAL_MS);
  };

  const onConnect = () => {
    void burst();
  };

  socket.on("connect", onConnect);
  void loop();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket.off("connect", onConnect);
  };
}

/** Test seam. Never called by the app. */
export function resetServerClock(): void {
  offsetMs = null;
  bestRttMs = Number.POSITIVE_INFINITY;
  acceptedAt = 0;
  acceptedCount = 0;
}
