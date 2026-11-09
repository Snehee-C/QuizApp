import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { getSocket } from "./socket";

/**
 * Venue Wi-Fi survival kit.
 *
 * Socket.IO reconnects on its own, but it reconnects with a NEW socket id, so
 * nothing about the old connection survives on the server: the phone is in no
 * room and `socket.data.{role,participantId}` is empty. Identity does NOT heal
 * itself — `participant:join` is idempotent, but something has to re-emit it,
 * which `Play.tsx` does on `connect`. Until that ack lands every submit is
 * rejected with "Join the session before submitting".
 *
 * A *submission* has a second hole: `socket.emit()` on a disconnected socket is
 * silently dropped (the default `volatile: false` buffer only covers the gap
 * between a drop and the browser noticing it), so the ack never arrives and
 * the player's answer is gone with no feedback at all.
 *
 * This module adds the missing pieces: an observable connection status for the
 * UI, and an at-most-one-pending-answer-per-slide retry queue whose idea of
 * "delivered" is the ack *body*, not merely the fact that an ack arrived.
 */

export type ConnectionStatus = "connecting" | "online" | "offline" | "reconnecting";

export interface ConnectionState {
  status: ConnectionStatus;
  /** Submissions accepted locally but not yet confirmed by the server. */
  queued: number;
}

export interface SubmitOptions {
  /**
   * How long to wait for the server's ack before assuming the emit was lost.
   * A quiz answer is worthless once the question closes, so this is short by
   * design — long enough to ride out a Wi-Fi hiccup, short enough that the
   * player sees "queued" rather than a dead UI.
   */
  timeoutMs?: number;
  /**
   * Identity of the slide this submission belongs to. Defaults to
   * `payload.slideId`, which is what every participant emit in this app
   * carries. Only one submission per key is ever retried.
   */
  slideKey?: string;
}

/** Ack deadline. Shorter than a typical 20s question so retry still matters. */
const DEFAULT_TIMEOUT_MS = 6000;

/**
 * How many times a *server-rejected* submit is re-sent before the player is
 * told. Bounded on purpose: a rejection that outlives the re-join is not going
 * to fix itself, and silently retrying forever is the same bug as silently
 * dropping, only with a spinner.
 */
const MAX_RETRIES = 3;
/**
 * Long enough for the `connect` re-join to complete a round trip, short enough
 * that the retry still lands inside a 20s question.
 */
const RETRY_DELAY_MS = 500;

interface QueuedSubmit {
  key: string;
  /** Monotonic, so a late failure can never resurrect itself over a newer tap. */
  seq: number;
  event: string;
  payload: unknown;
  timeoutMs: number;
  socket: Socket;
  resolve: (value: unknown) => void;
  settled: boolean;
  inFlight: boolean;
  /** Server-rejected re-sends spent so far. See MAX_RETRIES. */
  retries: number;
}

/**
 * Keyed by slide, never a list. Replaying several answers for one slide would
 * let an older tap land after a newer one and overwrite the player's real
 * final answer — the single worst outcome here, worse than losing the answer.
 * A Map keyed by slide makes that structurally impossible rather than
 * depending on ordering luck.
 */
const queue = new Map<string, QueuedSubmit>();
const listeners = new Set<() => void>();
const wiredSockets = new WeakSet<Socket>();

let seqCounter = 0;
/**
 * `undefined` = the caller has not told us which slide is live, so nothing is
 * dropped on slide identity. `null` = explicitly no live slide (session ended,
 * leaderboard on screen), so every queued answer is abandoned.
 */
let currentKey: string | null | undefined;

function notify(): void {
  for (const listener of listeners) listener();
}

/** Submissions accepted locally but not yet confirmed by the server. */
export function queuedCount(): number {
  return queue.size;
}

/** Subscribe to queue-size changes. Returns an unsubscribe function. */
export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isCurrent(key: string): boolean {
  return currentKey === undefined || currentKey === key;
}

function settle(entry: QueuedSubmit, value: unknown): void {
  if (entry.settled) return;
  entry.settled = true;
  entry.resolve(value);
}

/**
 * Puts `entry` in the queue, resolving whatever it displaces. Returns false if
 * the entry is already dead on arrival (stale slide, or an even newer answer
 * for the same slide is already waiting).
 */
function place(entry: QueuedSubmit): boolean {
  if (!isCurrent(entry.key)) {
    settle(entry, null);
    return false;
  }
  const existing = queue.get(entry.key);
  if (existing && existing !== entry) {
    if (existing.seq > entry.seq) {
      // A newer answer for this slide is already waiting; this one is history.
      settle(entry, null);
      return false;
    }
    settle(existing, null);
  }
  queue.set(entry.key, entry);
  return true;
}

/**
 * The error carried *inside* an ack body.
 *
 * Every participant handler on the server answers `cb({ error })` rather than
 * throwing, so an ack arriving is not evidence the answer landed — the queue
 * used to read it as success and delete the entry, which is how a rejected
 * answer vanished with no feedback at all.
 */
function ackError(res: unknown): string | null {
  if (res && typeof res === "object") {
    const e = (res as { error?: unknown }).error;
    if (typeof e === "string" && e) return e;
    if (e) return "Your answer didn't go through";
  }
  return null;
}

/**
 * The stable machine-readable rejection code (wire contract §2), when present.
 *
 * Every rejection ack keeps its human `error` text unchanged and adds this, so
 * client behaviour stops depending on server copy. A server that predates the
 * field returns null here and the caller falls back to wording.
 */
function ackCode(res: unknown): string | null {
  if (res && typeof res === "object") {
    const c = (res as { code?: unknown }).code;
    if (typeof c === "string" && c) return c;
  }
  return null;
}

/**
 * Is this rejection one that a successful re-join repairs?
 *
 * Only the identity rejection is. `NOT_JOINED` means the server does not yet
 * recognise this socket — it reconnected with a new id and `socket.data` is
 * empty — which `Play.tsx`'s `connect` re-join fixes within one round trip.
 * Every other rejection (`TOO_LATE`, `BAD_ANSWER`, `SESSION_ENDED`) is a
 * verdict on the answer itself and would retry until the heat death of the
 * question.
 *
 * Two codes are *deliberately* not retried, now that they can be told apart by
 * code rather than by accident of wording. `SAVE_FAILED` has a known
 * deterministic cause — a slide deleted from the deck mid-session — so
 * re-sending only delays telling the player by MAX_RETRIES × RETRY_DELAY_MS;
 * `SESSION_GONE` cannot be repaired by anything this client does. Both reach
 * the caller and are shown, which is the correct fail-safe for a player who
 * would otherwise be tapping into a void.
 */
const RETRYABLE_CODES = new Set(["NOT_JOINED"]);

/**
 * Wording fallback for a server that predates the `code` field, and ONLY that.
 * Consulted only when the ack carries no `code` — a code that is present is
 * authoritative, so an unrecognised one is not quietly re-matched against this
 * regex and retried anyway. Removable once no such server can answer us.
 */
const LEGACY_RETRYABLE_ERROR = /join the session/i;

function isRetryable(res: unknown, rejection: string): boolean {
  const code = ackCode(res);
  if (code) return RETRYABLE_CODES.has(code);
  return LEGACY_RETRYABLE_ERROR.test(rejection);
}

function attempt(entry: QueuedSubmit): void {
  entry.inFlight = true;
  // socket.io-client v4 `.timeout(ms).emit(...)` — the ack callback is invoked
  // with an error first if the server does not answer in time. Without it a
  // half-open socket leaves the player staring at a frozen screen forever.
  entry.socket
    .timeout(entry.timeoutMs)
    .emit(entry.event, entry.payload, (err: unknown, res: unknown) => {
      entry.inFlight = false;
      if (entry.settled) return;
      // A newer answer for this slide replaced us while we were in flight —
      // delivering this one now would undo the player's actual choice.
      if (queue.get(entry.key) !== entry) return;

      if (err) {
        // Stay queued. We deliberately do not retry on a still-connected
        // socket: duplicating an emit is riskier than waiting, and a socket
        // that is genuinely wedged gets torn down by the heartbeat within
        // seconds, which fires `connect` again and flushes us then.
        notify();
        return;
      }

      // An ack is not a receipt. `err` is set only on a *client-side* timeout,
      // so a server rejection arrives here as a perfectly ordinary ack and
      // used to be deleted and settled as a success.
      const rejection = ackError(res);
      if (rejection && isRetryable(res, rejection) && entry.retries < MAX_RETRIES) {
        entry.retries += 1;
        // Stay queued and come back under our own steam. `connect` has already
        // fired by the time this rejection arrives — that is *why* identity is
        // still being re-established — so waiting for the next `connect` would
        // mean waiting for the next outage.
        window.setTimeout(() => {
          if (entry.settled || queue.get(entry.key) !== entry) return;
          if (entry.inFlight || !entry.socket.connected) return;
          attempt(entry);
        }, RETRY_DELAY_MS);
        notify();
        return;
      }

      // Either it landed, or it failed for a reason retrying cannot fix. Both
      // go back to the caller — including the `{ error }` body, so the player
      // is told instead of tapping into a void.
      queue.delete(entry.key);
      settle(entry, res);
      notify();
    });
}

/**
 * Retry everything queued, now.
 *
 * Wired to `connect`, and called directly by `Play.tsx` the moment a re-join
 * ack lands: `connect` fires *before* the server knows who this socket is, so
 * the automatic flush races the re-join and can be rejected on identity.
 */
export function flushQueue(): void {
  for (const entry of [...queue.values()]) {
    if (!isCurrent(entry.key)) {
      queue.delete(entry.key);
      settle(entry, null);
      continue;
    }
    if (entry.inFlight || !entry.socket.connected) continue;
    attempt(entry);
  }
  notify();
}

function wire(socket: Socket): void {
  if (wiredSockets.has(socket)) return;
  wiredSockets.add(socket);
  // Intentionally never removed: this listener belongs to the socket
  // singleton and the module-level queue, both of which outlive any React
  // tree. Removing it on unmount would strand answers queued by a screen the
  // player navigated away from mid-reconnect.
  socket.on("connect", flushQueue);
}

function resolveKey(event: string, payload: unknown, opts: SubmitOptions): string {
  if (opts.slideKey) return opts.slideKey;
  if (payload && typeof payload === "object") {
    const slideId = (payload as { slideId?: unknown }).slideId;
    if (typeof slideId === "string" && slideId) return slideId;
  }
  // No slide identity available — fall back to the event name so at worst one
  // submission of this kind is ever pending, never a replayable backlog.
  return event;
}

/**
 * Emit with an ack timeout, queueing for retry if the socket is down or the
 * ack never lands.
 *
 * Resolves with the server's ack payload, or with `null` when the submission
 * was abandoned without ever reaching the server — because the slide moved on,
 * or because the player tapped a different answer for the same slide. It never
 * rejects: a dropped answer is a normal outcome on venue Wi-Fi, and an
 * unhandled rejection in the middle of a live game helps nobody.
 *
 * The resolved payload may be a server *rejection* (`{ error }`). Callers must
 * check for it: this queue retries the one rejection a re-join can repair and
 * hands back everything else, so "resolved" means "we are done trying", never
 * "it was accepted".
 */
export function submitWithRetry<T = unknown>(
  socket: Socket,
  event: string,
  payload: unknown,
  opts: SubmitOptions = {}
): Promise<T | null> {
  const key = resolveKey(event, payload, opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<T | null>((resolve) => {
    const entry: QueuedSubmit = {
      key,
      seq: ++seqCounter,
      event,
      payload,
      timeoutMs,
      socket,
      resolve: resolve as (value: unknown) => void,
      settled: false,
      inFlight: false,
      retries: 0,
    };

    wire(socket);
    const live = place(entry);
    notify();
    if (!live) return;

    if (socket.connected) attempt(entry);
    // Otherwise it simply sits in the queue until the next `connect`.
  });
}

/**
 * Tell the queue which slide is live. Pass `null` when no slide is (session
 * ended, leaderboard on screen).
 *
 * Anything queued for a different slide is abandoned immediately: a late
 * replay would score a question the room has already finished and moved past,
 * which reads as a bug to the player and corrupts the aggregate on screen.
 * Losing that answer is the lesser harm.
 */
export function setCurrentSlide(key: string | null): void {
  if (currentKey === key) return;
  currentKey = key;

  let changed = false;
  for (const entry of [...queue.values()]) {
    if (isCurrent(entry.key)) continue;
    queue.delete(entry.key);
    settle(entry, null);
    changed = true;
  }
  if (changed) notify();
}

/** Discard the current-slide filter entirely (back to "accept anything"). */
export function clearCurrentSlide(): void {
  currentKey = undefined;
}

/**
 * Live connection status plus the number of unconfirmed submissions.
 *
 * Status comes from the socket's own `connect` / `disconnect` /
 * `connect_error` plus the *manager*'s `reconnect_attempt`, which is the only
 * event that distinguishes "we are actively retrying" from "we are down".
 */
export function useConnection(): ConnectionState {
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    getSocket().connected ? "online" : "connecting"
  );
  const [queued, setQueued] = useState(queuedCount);

  useEffect(() => {
    const socket = getSocket();
    const manager = socket.io;

    // Manager-level, not component state: a `connect_error` fired between two
    // reconnect attempts must not downgrade "reconnecting" to "offline" and
    // make the banner flicker between two messages every second.
    let retrying = false;

    const onConnect = () => {
      retrying = false;
      setStatus("online");
    };
    const onDisconnect = () => setStatus("offline");
    const onConnectError = () => setStatus(retrying ? "reconnecting" : "offline");
    const onReconnectAttempt = () => {
      retrying = true;
      setStatus("reconnecting");
    };
    const onReconnectFailed = () => {
      retrying = false;
      setStatus("offline");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    manager.on("reconnect_attempt", onReconnectAttempt);
    manager.on("reconnect_failed", onReconnectFailed);

    const onQueue = () => setQueued(queuedCount());
    const unsubscribe = subscribeQueue(onQueue);

    // The socket is a singleton that may have connected long before this
    // component mounted, so the events above would never fire for us. Sync
    // once on mount instead of rendering a permanent false "connecting".
    if (socket.connected) setStatus("online");
    onQueue();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      manager.off("reconnect_attempt", onReconnectAttempt);
      manager.off("reconnect_failed", onReconnectFailed);
      unsubscribe();
    };
  }, []);

  return { status, queued };
}
