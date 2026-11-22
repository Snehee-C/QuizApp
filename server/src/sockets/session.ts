import type { Server, Socket } from "socket.io";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";
import { verifyToken } from "../auth.js";
import {
  computeAggregate,
  gradeSubmission,
  isInteractive,
  isTimed,
  publicConfig,
  revealPayload,
  timeLimitSec,
  validateValue,
} from "../slides/registry.js";
import { registerQaHandlers } from "./qa.js";
import { filterNickname, filterText, type FilterMode } from "../services/contentFilter.js";
import { clampTimeScale } from "../timeScale.js";
import { monoFromWall, withinNetworkGrace } from "../sessionClock.js";
import { createThrottle } from "../coalesce.js";

// In-memory live state per active session (keyed by joinCode).
interface LiveSession {
  sessionId: string;
  presentationId: string;
  ownerId: string;
  /** PRESENTER = host drives. AUDIENCE = each participant moves themselves. */
  pacing: "PRESENTER" | "AUDIENCE";
  /** How participant-authored text is treated before it reaches the screen. */
  filterMode: FilterMode;
  /** Multiplier applied to every countdown (accessibility: relaxed timing). */
  timeScale: number;
  slides: { id: string; type: string; question: string; config: any; order: number }[];
  currentIndex: number; // -1 = lobby
  status: "LOBBY" | "ACTIVE" | "ENDED";
  // Who is CONNECTED right now. Drives the lobby count and the "everyone has
  // answered" early reveal — both of which are questions about live sockets.
  participants: Map<string, { name: string; avatar: number }>;
  // Who has EVER been in this room, names included. A socket closing is not a
  // person ceasing to exist: the score outlives the connection, so the identity
  // has to as well, or a winner whose phone locked is announced on the podium
  // as "Anonymous". Loaded from the `Participant` table on a cold start, which
  // is also what makes a room rebuildable after a restart at all.
  roster: Map<string, { name: string; avatar: number }>;
  // The primary presenter socket: whichever host window issued the most recent
  // command. Kept for the `presenter:control` notice below.
  presenterSocketId: string | null;
  // EVERY host window currently attached to this room. One account can have
  // two (a forgotten tab, a phone used as a clicker) and both legitimately pass
  // the ownership check, so presenter-grade frames — the answer key, the live
  // tally, the leaderboard — go to all of them. Sending them to one socket only
  // meant the other tab silently received the PARTICIPANT view while still
  // driving the room perfectly, with nothing on screen to say which window was
  // the real one.
  presenterSockets: Set<string>;
  // wall-clock ms when the current slide became active. This is the value that
  // goes ON THE WIRE and into the database: clients and rows both speak
  // wall-clock, and only wall-clock survives a restart.
  currentSlideStartedAt: number | null;
  // The same instant on the MONOTONIC clock, which is what scoring reads.
  // Auto-reveal is a setTimeout (monotonic); grading used Date.now() (wall).
  // A clock step therefore moved one and not the other, so a backward step
  // handed out full marks and a forward step floored them while the question
  // stayed open. One clock for both means a step can no longer rewrite a score
  // behind the deadline's back.
  currentSlideStartedMono: number | null;
  // Audience pacing has no shared clock: the host never navigates, so there is
  // no single moment the room "arrived". Each player arrives at their own, and
  // that is the instant their answer must be timed from — otherwise the whole
  // deck is graded against whenever the host last happened to touch it, and the
  // penalty falls on reading pace, which is the exact axis `timeScale` exists
  // to protect. participantId -> the slide they are on and when they got there.
  audienceArrivals: Map<string, { slideId: string; mono: number }>;
  // Who the early reveal has to wait for on the slide currently on screen.
  //
  // "Everyone present has answered" used to be measured against `participants`,
  // which is a set that SHRINKS the moment a phone locks. One player answering
  // while they are momentarily the only live socket therefore closed the
  // question for everybody — the exact failure the numerator fix described,
  // arriving from the denominator. The cohort is everyone who has been
  // connected at any point while this slide has been on screen, so leaving
  // cannot shorten the list of people the room is waiting for. Someone who
  // walks out for good simply means the countdown closes the question instead
  // of the quorum, which is the safe direction to fail in.
  slideCohort: { slideId: string | null; ids: Set<string> };
  // Measured connectivity gaps, per participant: the evidence that justifies
  // crediting a client-claimed tap time (see `outageCreditFor`). Written when a
  // phone re-joins on a NEW socket while its old one is still registered —
  // which is what an ungraceful drop looks like from here — and consumed by the
  // next submission. Never written on the client's say-so.
  outageCredits: Map<string, { creditMs: number; expiresAt: number }>;
  // participantId -> wall-clock ms of the last packet we received from the
  // socket that owned that identity, written when that socket drops or is
  // displaced. This is the server's own record of when a phone went quiet, and
  // it is the only thing that can turn a client's claim about when it tapped
  // into points — see `measureOutage`.
  lastHeardFrom: Map<string, number>;
  // participantId -> the opaque key the ROOM is allowed to know them by.
  // Memoised rather than stored: the key is an HMAC over (sessionId,
  // participantId), so it is identical in every process and survives a restart
  // without a column, and this map only saves recomputing it per frame.
  publicKeys: Map<string, string>;
  // pending auto-reveal timer for the current quiz slide (fires on time-up)
  revealTimer: ReturnType<typeof setTimeout> | null;
  // slideIds already revealed — revealing is one-shot per slide
  revealedSlides: Set<string>;
  // When each reveal fired, on the monotonic clock. Only ever read by the
  // network grace below, which needs to know not THAT a question closed but
  // HOW LONG AGO. Deliberately not persisted: a reveal that predates a restart
  // is definitively old, and an absent entry means no grace, which is the safe
  // direction to fail.
  revealedAtMono: Map<string, number>;
  // The exact `slide:reveal` frame we emitted, per slideId. A reveal is a
  // one-shot broadcast, so a phone that was offline for it — or a host who
  // navigates back onto the slide — has no way to learn the question is closed.
  // Keeping the payload lets us re-send the identical frame instead of leaving
  // the room staring at a live countdown on a question nobody can answer.
  revealPayloads: Map<string, any>;
  // participantId -> the socket id that currently owns that identity. A player
  // may have several sockets alive at once (a second tab, a backgrounded tab
  // that has not timed out yet); only the newest one is "them", so a stale
  // socket's disconnect must not evict the live one.
  participantSockets: Map<string, string>;
  // The standings the room is looking at RIGHT NOW, or null when they are not
  // on screen. `leaderboard:show` is a one-shot broadcast, so a phone that
  // reloads while the projector shows the scoreboard comes back rendering the
  // slide and drops out of a moment the whole room is sharing. Holding the
  // exact frame we broadcast lets the join ack put that phone back in it.
  leaderboardView: { entries: PublicLeaderboardRow[] } | null;
  // The SAME moment at stage scope. Two fields rather than two keys on one
  // object, deliberately: `leaderboardView` is handed to a participant verbatim
  // on the join ack, so the object a phone receives must be incapable of
  // carrying rows a phone may not have. A field it does not know about cannot
  // be forgotten in a projection. Set and cleared in lockstep with it, so
  // `leaderboardView === null` remains the one answer to "is the board up" —
  // which is the signal the phones' rank embargo is released by.
  stageLeaderboardView: LeaderboardEntryRow[] | null;
  // Serialises navigation. `goto` awaits a DB write halfway through, so two
  // overlapping calls interleave there and the later emit wins carrying a
  // stale slide with a fresh index — the room and the stage then disagree
  // until the next navigation. Chaining every nav onto this promise means a
  // burst of Next presses is applied strictly in order.
  navChain: Promise<unknown>;
  // Last time anything happened in this room, for the idle reaper below.
  lastActivityAt: number;
  // When the host ended it, so an ended room can linger briefly for stragglers
  // and then be evicted instead of being retained for the life of the process.
  endedAtMs: number | null;
}

const live = new Map<string, LiveSession>();

// The monotonic clock. `performance.now()` cannot step backwards and cannot be
// dragged by NTP, a VM resume or a manual correction — which is precisely why
// setTimeout already uses it. Scoring now reads the same one.
function monoNow(): number {
  return performance.now();
}

// Throttle join-code guessing: the 6-digit space is only 900k, so an attacker
// could enumerate live sessions.
//
// A purely per-IP budget punishes the wrong people: a classroom, a lecture hall
// or a conference sits behind one NAT, so ten students fat-fingering the code
// on the projector locks out everyone else in the building for a minute — the
// single most common honest mistake becomes a room-wide outage. So the budget
// a human can actually exhaust is keyed per *device* (ip + participantId, the
// id the client already persists), which means a mistyper only ever locks out
// themselves and their neighbours are untouched.
//
// A device key is client-supplied and therefore rotatable, so it cannot be the
// defence against enumeration — the per-IP budget still exists, but set far
// above anything human thumbs can reach in a minute. Thirty people mistyping
// twice each stays comfortably under it; a script walking the code space does
// not, and at this rate a full sweep of the 900k space takes days, by which
// time every code it is hunting has expired with its session.
//
// "Anything human thumbs can reach" was the wrong unit. A restart is not thumbs
// — it is one automatic failure per phone, simultaneously, from the single NAT
// a venue sits behind, and 301 devices failing ONCE each exhausted a 300-budget
// and then refused an innocent phone the host's new, valid code for a minute.
// Two rules keep the budget on the behaviour it was written for:
//
//   * Only a failure against a code the DATABASE has never heard of spends the
//     per-IP budget. That is what enumeration looks like — the 900k space is
//     sparse, so a sweep is almost entirely misses. A failure against a code
//     that does exist (an ended room, a room mid-recovery) is an honest client
//     arriving at a real place at the wrong moment, and it is charged only to
//     its own device.
//   * A SUCCESSFUL join forgives that device's failures, and withdraws them
//     from the IP's tally too. A phone that fumbles the code twice and then
//     gets in has cost the building nothing, which is the truth of what
//     happened.
//
// The IP check still runs BEFORE the code is looked up, deliberately: a
// throttled caller must not be able to tell a wrong code from a right one by
// the shape of the refusal, or the throttle becomes a free oracle.
const JOIN_WINDOW_MS = 60_000;
const JOIN_MAX_FAILURES_PER_DEVICE = 10;
const JOIN_MAX_FAILURES_PER_IP = 300;
const joinFailures = new Map<string, { count: number; resetAt: number }>();

function joinKeys(ip: string, participantId: unknown): [string, string] {
  // Unidentified callers all collapse onto one device key per IP, so a client
  // that simply omits the id gets the strict budget rather than an exemption.
  const device = typeof participantId === "string" && participantId ? participantId : "anon";
  return [`ip:${ip}`, `dev:${ip}|${device}`];
}

function overBudget(key: string, max: number): boolean {
  const rec = joinFailures.get(key);
  return !!rec && Date.now() < rec.resetAt && rec.count >= max;
}

function tooManyJoinFailures(ip: string, participantId: unknown): boolean {
  const [ipKey, deviceKey] = joinKeys(ip, participantId);
  return overBudget(ipKey, JOIN_MAX_FAILURES_PER_IP) || overBudget(deviceKey, JOIN_MAX_FAILURES_PER_DEVICE);
}

function bump(key: string, now: number) {
  const rec = joinFailures.get(key);
  if (!rec || now >= rec.resetAt) {
    joinFailures.set(key, { count: 1, resetAt: now + JOIN_WINDOW_MS });
  } else {
    rec.count++;
  }
}

/**
 * Charge a failed join.
 *
 * `unknownCode` says whether the code is one the database has never issued —
 * the only class of failure that looks like enumeration, and so the only class
 * that may spend the shared per-IP budget. Everything else (a room that has
 * ended, a malformed participant) is charged to the one device that did it.
 */
function recordJoinFailure(ip: string, participantId: unknown, unknownCode: boolean) {
  const now = Date.now();
  // Device keys are per-client, so the map would otherwise grow without bound
  // over a long-running server. Expired windows carry no information — drop them.
  if (joinFailures.size > 1000) {
    for (const [key, rec] of joinFailures) if (now >= rec.resetAt) joinFailures.delete(key);
  }
  const [ipKey, deviceKey] = joinKeys(ip, participantId);
  bump(deviceKey, now);
  if (unknownCode) bump(ipKey, now);
}

/**
 * A join succeeded, so the failures that preceded it were fumbles, not an
 * attack. Clear the device's window entirely and withdraw exactly the failures
 * it contributed from the IP's — never more, so one device cannot launder
 * another's budget by succeeding.
 */
function forgiveJoinFailures(ip: string, participantId: unknown) {
  const now = Date.now();
  const [ipKey, deviceKey] = joinKeys(ip, participantId);
  const dev = joinFailures.get(deviceKey);
  joinFailures.delete(deviceKey);
  const spent = dev && now < dev.resetAt ? dev.count : 0;
  if (!spent) return;
  const ipRec = joinFailures.get(ipKey);
  if (!ipRec || now >= ipRec.resetAt) return;
  ipRec.count = Math.max(0, ipRec.count - spent);
  if (ipRec.count === 0) joinFailures.delete(ipKey);
}

// socket.handshake.address is the raw TCP peer, which behind a reverse proxy
// (Render, nginx, ...) is the proxy itself — the SAME for every client, so the
// throttle above would apply globally instead of per-client. Engine.IO does not
// honor Express's `trust proxy`, so we read the forwarded header ourselves,
// taking the left-most (original client) hop. Falls back to the peer address
// locally where no proxy sets the header.
function clientIp(socket: Socket): string {
  const xff = socket.handshake.headers["x-forwarded-for"];
  const forwarded = Array.isArray(xff) ? xff[0] : xff;
  const first = forwarded?.split(",")[0]?.trim();
  return first || socket.handshake.address || "unknown";
}

// Matches the cap `qa:ask` puts on authorName — the same name ends up in the
// same lobby chip and leaderboard row, so they must agree.
const MAX_NICKNAME_LEN = 24;

function genJoinCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// A slide as sent over the wire. `withAnswers` controls whether the quiz answer
// key travels with it — it must NEVER reach participants, whose browsers can
// read any socket frame, so the default is to strip it. What counts as an
// answer key is decided by the owning slide module.
function publicSlide(s: LiveSession["slides"][number], withAnswers = false) {
  return {
    id: s.id,
    type: s.type,
    question: s.question,
    config: withAnswers ? s.config : publicConfig(s.type, s.config),
    order: s.order,
  };
}

// Where a navigation wants to go, resolved late. `vacancy` is non-null only
// when the slide the room was looking at has just been pruned out of the deck,
// and carries the slot it used to occupy — an absolute move ignores it, a
// relative one counts from it. See `reconcileDeletedSlides`.
type NavTarget = (s: LiveSession, vacancy: number | null) => number;

function currentSlideOf(s: LiveSession, withAnswers = false) {
  if (s.currentIndex < 0 || s.currentIndex >= s.slides.length) return null;
  return publicSlide(s.slides[s.currentIndex], withAnswers);
}

// Stable machine-readable reasons for every rejection ack. Two client
// decisions used to key off the WORDING of `error` — a submit retry on
// /join the session/i, and the route to the results screen on the literal
// "Session has ended" — so rewording one sentence silently changed behaviour
// nothing tested. `error` stays byte-identical (older clients still match on
// it); `code` is what new clients branch on.
export type RejectCode =
  | "NOT_JOINED"
  | "SESSION_ENDED"
  | "SESSION_GONE"
  | "BAD_CODE"
  | "SLIDE_GONE"
  | "NOT_ANSWERABLE"
  | "BAD_ANSWER"
  | "TOO_LATE"
  | "SAVE_FAILED"
  | "RATE_LIMITED"
  // Beyond the contract's table: every other rejection this file can emit, so
  // "every ack carries a code" holds with no exceptions for a client to
  // special-case.
  | "UNAUTHORIZED"
  | "DECK_GONE"
  | "EMPTY_DECK"
  | "NO_LIVE_SESSION"
  | "BAD_PARTICIPANT"
  | "SEAT_TAKEN"
  | "SEAT_UNVERIFIED"
  | "HOST_PACED"
  | "NAV_FAILED"
  | "FILTERED"
  // Q&A and reactions reject in their own module but speak the same protocol,
  // so they import this union rather than minting a parallel vocabulary: one
  // table, and a second spelling of an existing reason fails to compile.
  | "EMPTY_QUESTION"
  | "QUESTION_GONE"
  | "BAD_STATUS";

function reject(cb: Function | undefined, code: RejectCode, error: string) {
  cb?.({ error, code });
}

// ---- Seat secrets ----
//
// A `participantId` used to be the whole of a seat: `participant:join` bound
// the socket to whatever id it was handed, so knowing someone's id was enough
// to BE them — take their seat, read their result, overwrite their answers
// (submit upserts by it). And ids are not secret: the presenter holds every
// one, the CSV export prints them, and for most of this app's life the phones'
// own leaderboard carried ten of them.
//
// So a seat now has a secret. The phone mints 256 random bits beside its id
// and sends them on every join; the join that CLAIMS a seat stores only their
// SHA-256, and every later join for the seat must present the same secret.
// The phone mints it, not the server, so there is no window between claiming
// a seat and learning its secret: a phone that emits its join twice before the
// first ack lands (a reconnect mid-join) sends the same secret both times.
//
// A join with NO secret (a phone still running the bundle from before this
// existed — a tab left open across the deploy) neither claims a seat nor gets
// into a claimed one. Minting it one would be worse than useless: that bundle
// cannot store what it is handed, so its next reconnect would arrive without
// the secret and be refused the seat the server had just locked for it. Left
// unclaimed, it behaves exactly as it did before, until it reloads into the
// current bundle and claims for real. Everything
// downstream — submit, goto, Q&A — already trusts `socket.data.participantId`
// rather than the payload, so this one gate covers them all.
//
// A seat with no hash on record (created before the column existed, i.e. a
// room that was live across the deploy) is claimed by its next join: trust on
// first use, which is exactly what the room had before, once.

// Client ids are UUIDs (36 chars). The cap is generous, and it exists because
// an id is persisted, used as a key in five maps and the join throttle, and
// broadcast — an uncapped one is memory and rows of whatever size a frame
// allows, rotated per join.
const MAX_PARTICIPANT_ID_LEN = 64;

function badParticipantId(participantId: unknown): boolean {
  return typeof participantId === "string" && participantId.length > MAX_PARTICIPANT_ID_LEN;
}

const SEAT_SECRET_MIN_LEN = 32;
const SEAT_SECRET_MAX_LEN = 128;

function wellFormedSecret(secret: unknown): secret is string {
  return (
    typeof secret === "string" &&
    secret.length >= SEAT_SECRET_MIN_LEN &&
    secret.length <= SEAT_SECRET_MAX_LEN
  );
}

function hashSeatSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function seatSecretMatches(secret: unknown, storedHash: string): boolean {
  if (!wellFormedSecret(secret)) return false;
  const given = Buffer.from(hashSeatSecret(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

type SeatCheck = { ok: true } | { ok: false; reason: "taken" };

/**
 * Verify the caller holds this seat, claiming it with the caller's own secret
 * if nobody does yet. A caller with no secret passes only an unclaimed seat,
 * and does not claim it (see "Seat secrets").
 *
 * Two phones racing to claim the same unclaimed seat both try a conditional
 * write; exactly one lands, and the loser re-reads and is verified (and
 * refused) like any later join. Throws on a database failure: the caller
 * fails CLOSED, because "could not check" must not mean "let them in".
 */
async function claimOrVerifySeat(
  sessionId: string,
  participantId: string,
  secret: unknown
): Promise<SeatCheck> {
  const where = { sessionId_participantId: { sessionId, participantId } };
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await prisma.participant.findUnique({ where, select: { seatSecretHash: true } });
    if (row?.seatSecretHash) {
      return seatSecretMatches(secret, row.seatSecretHash) ? { ok: true } : { ok: false, reason: "taken" };
    }
    if (!wellFormedSecret(secret)) return { ok: true };
    const seatSecretHash = hashSeatSecret(secret);
    if (!row) {
      try {
        await prisma.participant.create({ data: { sessionId, participantId, seatSecretHash } });
        return { ok: true };
      } catch (e: any) {
        // P2002: somebody created the row between our read and our write.
        if (e?.code !== "P2002") throw e;
        continue;
      }
    }
    const { count } = await prisma.participant.updateMany({
      where: { sessionId, participantId, seatSecretHash: null },
      data: { seatSecretHash },
    });
    if (count === 1) return { ok: true };
  }
  // Lost the race twice, which means the seat now has a hash we did not set.
  const row = await prisma.participant.findUnique({ where, select: { seatSecretHash: true } });
  return row?.seatSecretHash && seatSecretMatches(secret, row.seatSecretHash)
    ? { ok: true }
    : { ok: false, reason: "taken" };
}

/**
 * Read-only: may this caller read this seat's private result? For the
 * finished-room refusal, which hands back a rank and a score and claims
 * nothing. An unclaimed seat answers as it did before secrets existed.
 */
async function holdsSeat(sessionId: string, participantId: string, secret: unknown): Promise<boolean> {
  const row = await prisma.participant.findUnique({
    where: { sessionId_participantId: { sessionId, participantId } },
    select: { seatSecretHash: true },
  });
  if (!row) return false;
  return row.seatSecretHash ? seatSecretMatches(secret, row.seatSecretHash) : true;
}

// The secret the room-facing participant key is derived under. Falls back to
// the JWT secret so a deployment that sets one gets both, and to the same dev
// value `auth.ts` uses so a local checkout needs no configuration. It is a
// derivation key, never sent anywhere.
const PKEY_SECRET =
  process.env.PARTICIPANT_KEY_SECRET || process.env.JWT_SECRET || "dev-secret-change-me";

/**
 * The opaque key a PARTICIPANT may know another participant by.
 *
 * A `participantId` is a bearer token with no secret: it is the whole of what
 * `participant:join` needs to take that seat and overwrite that person's
 * answers. So it may never appear in a frame a phone receives — and that is
 * exactly what `participant:count` was doing, room-wide, before the first
 * question, which is the hole `PUBLIC_LEADERBOARD_LIMIT` was capped to keep
 * ten ids wide.
 *
 * HMAC rather than a random per-session table, for two reasons. It is not
 * reversible — recovering the id would mean inverting SHA-256 — so a phone
 * holding a `pkey` holds nothing it can join with. And it is deterministic over
 * (sessionId, participantId), so it survives a server restart: a room rebuilt
 * from the database hands back the SAME keys, and a client using them as React
 * keys or to diff the roster does not see every player replaced by a stranger
 * the moment the process recycles. Scoped by sessionId so the same person in
 * two rooms is not correlatable across them.
 */
function publicKeyFor(s: LiveSession, participantId: string): string {
  const hit = s.publicKeys.get(participantId);
  if (hit) return hit;
  const key = createHmac("sha256", PKEY_SECRET)
    .update(s.sessionId)
    // A separator no id can contain, so (sessionId, participantId) cannot be
    // re-partitioned into a different pair that hashes the same.
    .update("\u0000")
    .update(participantId)
    .digest("base64url")
    .slice(0, 22);
  s.publicKeys.set(participantId, key);
  return key;
}

// The one spelling of "who is in the room". The `participant:count` broadcast,
// its disconnect twin and the presenter's resume ack all describe the same
// thing, so they ship the same field names and the same element shape and the
// client can reduce all three through a single code path.
//
// `withIds` is the difference between the two audiences, and it is not a
// preference. A participant row is `{ pkey, name, avatar }` and carries no
// `participantId` at all; the presenter's row keeps the real id alongside the
// key, because moderation needs to name a person to act on them. The two
// shapes are never merged onto one object that a phone then receives — a field
// that is not there cannot be forgotten in a projection.
function participantsPayload(s: LiveSession, withIds: boolean) {
  return {
    count: s.participants.size,
    participants: [...s.participants].map(([participantId, p]) => ({
      pkey: publicKeyFor(s, participantId),
      ...(withIds ? { participantId } : null),
      name: p.name,
      avatar: p.avatar,
    })),
  };
}

/**
 * Broadcast the roster, stamped per socket with the shape that socket is
 * entitled to — the same room walk `emitSessionEnded` performs, for the same
 * reason: one payload cannot be correct for both audiences at once.
 *
 * Replaces `io.to(joinCode).emit("participant:count", …)`, and the recipient
 * set is deliberately byte-identical to it: host windows are in the room too
 * and still get the event, with the ids they already receive everywhere else.
 */
async function emitParticipants(io: Server, joinCode: string, s: LiveSession) {
  const forParticipants = participantsPayload(s, false);
  const forPresenters = participantsPayload(s, true);
  const sockets = await io.in(joinCode).fetchSockets();
  for (const sock of sockets) {
    sock.emit("participant:count", sock.data?.role === "presenter" ? forPresenters : forParticipants);
  }
}

/** Fire-and-forget wrapper: a roster frame must never hold up a handler. */
function pushParticipants(io: Server, joinCode: string, s: LiveSession) {
  emitParticipants(io, joinCode, s).catch((err) =>
    console.error("[participant:count] failed to notify room", joinCode, err)
  );
}

const LEADERBOARD_PUSH_MS = Number(process.env.LEADERBOARD_PUSH_MS ?? 500);

/**
 * "14 of 32 have answered" — the one fact about the room a phone that has
 * already answered is allowed to hold while it waits.
 *
 * The stage has carried this count since the beginning; phones never got it,
 * and a host-paced player spent the 15 seconds after answering reading "Hold
 * tight" with no bound on it. Two integers and the slide they describe, and
 * nothing else: no roster, no ids, no aggregate (which under some types is
 * computed from the answer key, and which is why `results:updated` stays
 * presenter-only). `total` is the slide's cohort — the people the early
 * reveal is waiting for — so the two numbers agree with the one the stage
 * closes the question on.
 *
 * Coalesced on the same window `leaderboard:updated` uses, for the same
 * reason: this fires once per submission, and a full room answering at once
 * is one frame's worth of news, not two hundred. The whole room receives it
 * (host windows included — they already hold more), through `io.to`, which
 * is the same recipient set `participant:count` uses.
 */
async function emitAnsweredCount(io: Server, joinCode: string, s: LiveSession, slideId: string) {
  // One row per (participant, slide), so a count is a distinct count.
  const answered = await prisma.response.count({ where: { sessionId: s.sessionId, slideId } });
  const cohort = s.slideCohort.slideId === slideId ? s.slideCohort.ids.size : s.participants.size;
  // A phone that answered and then dropped its socket is in `answered` and
  // may have left the connected set; the number is never allowed to read
  // "5 of 4".
  const total = Math.max(cohort, answered);
  io.to(joinCode).emit("answered:count", { slideId, answered, total });
}

const answeredPushes = createThrottle<{ io: Server; joinCode: string; s: LiveSession; slideId: string }>(
  LEADERBOARD_PUSH_MS,
  (_key, { io, joinCode, s, slideId }) => {
    emitAnsweredCount(io, joinCode, s, slideId).catch((err) =>
      console.error("[answered:count] failed to notify room", s.sessionId, err)
    );
  }
);

/** Fire-and-forget, coalesced. Host-paced rooms only — a self-paced deck has no shared slide to count against. */
function pushAnsweredCount(io: Server, joinCode: string, s: LiveSession, slideId: string) {
  if (s.pacing !== "PRESENTER") return;
  answeredPushes.push(s.sessionId, { io, joinCode, s, slideId });
}

// Socket.IO JSON-encodes every payload, so `NaN` and `Infinity` arrive here as
// `null` — and `Number(null) === 0`. A `Number.isFinite` guard therefore never
// ran for the exact values it was written for: the intended no-op became
// "jump to slide 0" and dragged the whole room with it. Validate the value
// that actually came off the wire, not the one the sender meant to send.
// A finite number, or a string that is wholly one, is an index; `null`,
// `undefined`, booleans, arrays and objects are not indices by any reading, so
// they return null and the caller holds position.
//
// Floor, not trunc, and the difference is load-bearing: `Math.trunc(-0.5)` is
// `-0`, and `-0 < 0` is false, so a fractional negative slipped past the
// caller's "a negative index holds position" guard and moved the whole room to
// slide 0 — while -1, -5 and -999 all correctly held. Flooring drops the sign
// into the integer where the guard can see it (-0.5 -> -1) and is identical to
// trunc for every non-negative value, which is every value a client sends.
function wireIndex(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.floor(raw) : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }
  return null;
}

// Reconcile the live snapshot against slides that have been DELETED from the
// deck mid-session.
//
// The snapshot is deliberately frozen at create/resume time and that is
// correct for edits: a slide whose text changed under a running room keeps
// serving the words the room already saw, which is what everyone expects of a
// question already on the wall. Deletion is the one edit a frozen snapshot
// cannot ride out — the row is gone, so `Response` has no slide to point at
// and every submit comes back "Could not save response"; the room is handed a
// question it is structurally unable to answer.
//
// So prune, never refresh: survivors keep their snapshotted content (the edit
// semantics above are untouched), newly added slides are still ignored, and
// only the vanished ids are dropped.
//
// Returns the VACANCY — the slot the deleted slide used to occupy, counted in
// the pruned list — or null when the slide the room is looking at survived.
// Two things need it. The caller has to broadcast a displacement rather than
// absorb it quietly; and a relative move (Next/Back) has to be measured from
// where the deleted slide WAS, not from the survivor the prune silently
// re-seated the room onto. Measuring from the re-seat is how Next used to skip
// the very slide the prune had just moved the room to, in front of an audience
// and with nothing to tell the host a question had been missed.
async function reconcileDeletedSlides(s: LiveSession): Promise<number | null> {
  const rows = await prisma.slide.findMany({
    // "Deleted" means the deck no longer lists it, which is now a tombstone
    // rather than a missing row (schema.prisma, Slide.deletedAt) — the row
    // itself has to outlive the deck edit so the responses already scored
    // against it survive. Reading the live set here keeps this function's
    // behaviour byte-identical to when deletes were real: same prune, same
    // re-seat, same broadcast.
    where: { presentationId: s.presentationId, deletedAt: null },
    select: { id: true },
  });
  const alive = new Set(rows.map((r) => r.id));
  if (s.slides.every((sl) => alive.has(sl.id))) return null;

  const showingIdx = s.currentIndex;
  const showingId = showingIdx >= 0 ? s.slides[showingIdx]?.id ?? null : null;
  // Where the on-screen slide sat, expressed in the list that is about to
  // survive: the number of survivors ahead of it. Computed BEFORE the filter,
  // because afterwards the deleted slide has no position to speak of.
  const vacancy =
    showingIdx >= 0 ? s.slides.slice(0, showingIdx).filter((sl) => alive.has(sl.id)).length : 0;
  const kept = s.slides.filter((sl) => alive.has(sl.id));
  s.slides = kept;

  if (showingId === null) return null; // in the lobby: nothing is on screen
  const stillThere = kept.findIndex((sl) => sl.id === showingId);
  if (stillThere >= 0) {
    // The current slide survived; only its neighbours went. Keep the room
    // exactly where it is (its index may have shifted left) and say nothing —
    // re-emitting here would restart the clock on a live question.
    s.currentIndex = stillThere;
    return null;
  }
  // The slide on screen is the one that was deleted. Fall into the vacancy —
  // the deck's natural successor — clamped into range, which on the last slide
  // of the deck means falling back onto its predecessor instead. Seating by
  // vacancy rather than by the old index also keeps this right when the same
  // edit deleted slides BEFORE the current one: the old number then points
  // past the successor, and the room skipped a slide it had never seen.
  s.currentIndex = Math.min(vacancy, kept.length - 1);
  return vacancy;
}

async function emitResults(io: Server, joinCode: string, slideId: string) {
  const s = live.get(joinCode);
  if (!s) return;
  const slide = s.slides.find((x) => x.id === slideId);
  if (!slide) return;
  const responses = await prisma.response.findMany({
    where: { sessionId: s.sessionId, slideId },
    select: { participantId: true, value: true },
  });
  const aggregate = computeAggregate(slide.type, slide.config, responses);
  // Presenter-only. Participants never render live results, and broadcasting
  // the aggregate to the room while answering is still open puts derived hints
  // on the wire that a player can read in devtools — a running tally invites a
  // bandwagon, and for types like GUESS_NUMBER the aggregate carries fields
  // computed from the answer key. Participants get the aggregate they need in
  // the `slide:reveal` payload, after the window has closed.
  emitToPresenters(io, s, "results:updated", { slideId, aggregate });
}

/**
 * Every host window attached to this room, not just the one that pressed the
 * last key. A second tab is a legitimate thing to have open — and whichever one
 * is not currently "primary" was being served the participant view, which is
 * how a host ended up driving a room from a window that could not highlight the
 * correct answer, had no answer tally and no leaderboard.
 */
function presenterTargets(s: LiveSession): string[] {
  return [...s.presenterSockets];
}

function emitToPresenters(io: Server, s: LiveSession, event: string, payload: any) {
  const targets = presenterTargets(s);
  if (targets.length === 0) return;
  io.to(targets).emit(event, payload);
}

/**
 * Tell every host window who is currently primary and how many of them there
 * are, so "which of these two tabs is the real one" stops being unanswerable.
 * Purely informational — both windows are fully functional either way.
 */
function announcePresenters(io: Server, s: LiveSession) {
  emitToPresenters(io, s, "presenter:control", {
    controllingSocketId: s.presenterSocketId,
    presenterCount: s.presenterSockets.size,
  });
}

// How many rows a PARTICIPANT may be handed. Ten is what fits on a phone, but
// the binding reason it is not raised is that every row carries a
// `participantId` — and that id is the whole of what `participant:join` needs
// to assume somebody else's identity and overwrite their answers. A ten-row
// board already spends ten of them on the room; a full one would hand every
// phone present the keys to every other phone present.
const PUBLIC_LEADERBOARD_LIMIT = 10;

// How many rows the STAGE may be handed. The presenter is the one party
// entitled to see the whole room — it already receives the answer key, the
// live tally and the roster — and the bar race cannot animate a climb that
// starts off the board: a player arriving from 11th has no remembered row, so
// the one row on screen that genuinely moved is the one row that does not
// move. The stage still DRAWS five; this is a wire bound, not an editorial
// one, which is why it is generous and why raising it changes no rendering.
const STAGE_LEADERBOARD_LIMIT = Number(process.env.STAGE_LEADERBOARD_LIMIT ?? 200);

// Score is the sum of `points` across all of a participant's responses in this
// session. Because responses are upserted (one row per participant+slide),
// this naturally handles a participant changing their answer — no risk of
// double-counting points from a resubmission.
async function computeLeaderboard(s: LiveSession, limit = PUBLIC_LEADERBOARD_LIMIT) {
  const rows = await prisma.response.groupBy({
    by: ["participantId"],
    where: { sessionId: s.sessionId },
    _sum: { points: true },
  });
  // Resolve names through the ROSTER, not the connected set. A player who locks
  // their phone, closes the tab or simply walks out keeps their points — and
  // used to lose their name with their socket, so the winner of a quiz could be
  // announced on the podium, in front of the room, as "Anonymous" with the
  // wrong avatar. The roster outlives the connection, so the person does too.
  const who = (id: string) => s.roster.get(id) ?? s.participants.get(id);
  const entries = rows
    .map((r) => ({
      participantId: r.participantId,
      // Carried alongside the id, not yet instead of it. A leaderboard row
      // reaching a phone still carries a real `participantId`, and that is the
      // same bearer token N1 took off `participant:count` — ten stealable seats
      // per room rather than the whole roster, but the same class of thing.
      // The client identifies its own row by comparing against the `myPkey` on
      // its join ack, so once every renderer keys off `pkey` the id can be
      // stripped from participant-facing boards and the last of them leaves the
      // wire. Additive first, on purpose: a renderer that still reads
      // `participantId` keeps working while that switch is made.
      pkey: publicKeyFor(s, r.participantId),
      name: who(r.participantId)?.name ?? "Anonymous",
      score: r._sum.points ?? 0,
      avatar: who(r.participantId)?.avatar ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
  return {
    // What a PARTICIPANT may see. Ten rows — and, now, ten rows carrying no
    // `participantId`.
    //
    // The cap was always the wrong half of the protection. It bounded HOW MANY
    // bearer tokens went to each phone rather than whether any did, because a
    // `participantId` is the whole of what `participant:join` needs to take
    // that seat and overwrite that person's answers (N1). Ten stealable seats
    // per room is better than a whole roster and is still ten.
    //
    // Nothing on a phone needs the id: a player finds their own row by
    // comparing `pkey` against the `myPkey` on their join ack, and every
    // renderer keys rows by `pkey`. The cap stays regardless — it is also a
    // legibility and bandwidth bound, and `stageEntries` below is the frame
    // that deliberately sees more, because the presenter already holds the
    // roster and the answer key.
    entries: entries.map(({ participantId: _omit, ...row }) => row).slice(0, limit),
    // What the STAGE may see. See STAGE_LEADERBOARD_LIMIT.
    stageEntries: entries.slice(0, STAGE_LEADERBOARD_LIMIT),
    // Everyone, in order. For rank/score lookups only — this never goes on the
    // wire, because a board is scoped by who receives it and this one is not.
    fullEntries: entries,
  };
}

// Background data refresh — only the presenter uses this (to know whether
// any scores exist yet, for showing the leaderboard button at all, and to hold
// the board the bar race will run from). It does NOT make the leaderboard
// visible to participants; that's a separate, explicit show/hide broadcast
// below, so everyone sees it at the same time. Takes already-computed entries
// so callers that just ran computeLeaderboard (e.g. to grade a submission)
// don't pay for a second identical query.
//
// COALESCED, because this fires on every single submission. One board per
// answer was affordable while a board was ten rows; at stage scope a 200-player
// room would push 200 boards of 200 rows — tens of thousands of rows, several
// megabytes — at a projector that is rendering none of them, because the
// standings are not on screen while people are still answering. So the first
// push in a burst goes immediately (the host must see the Scores button light
// up on the first answer) and the rest collapse into one trailing frame.
//
// Every moment that actually puts a board in front of a room — a reveal, a
// show, a navigation, a resumed stage — passes `immediate` and is therefore
// exact. The only thing a window can ever delay is a mid-answering refresh
// that the next push supersedes anyway.
const leaderboardPushes = new Map<
  string,
  { lastAt: number; timer: ReturnType<typeof setTimeout> | null; pending: LeaderboardEntryRow[] | null }
>();

function sendLeaderboardToPresenter(
  io: Server,
  s: LiveSession,
  entries: LeaderboardEntryRow[],
  immediate = false
) {
  // Keyed by sessionId rather than join code: `live` is a cache, and the same
  // room rebuilt after a restart is the same session.
  const key = s.sessionId;
  let st = leaderboardPushes.get(key);
  if (!st) {
    st = { lastAt: 0, timer: null, pending: null };
    leaderboardPushes.set(key, st);
  }
  const now = Date.now();
  if (immediate || now - st.lastAt >= LEADERBOARD_PUSH_MS) {
    if (st.timer) clearTimeout(st.timer);
    st.timer = null;
    st.pending = null;
    st.lastAt = now;
    emitToPresenters(io, s, "leaderboard:updated", { entries });
    return;
  }
  // Inside the window: keep the newest board and send that one, once.
  st.pending = entries;
  if (!st.timer) {
    st.timer = setTimeout(() => {
      const cur = leaderboardPushes.get(key);
      if (!cur) return;
      cur.timer = null;
      const queued = cur.pending;
      cur.pending = null;
      if (!queued) return;
      cur.lastAt = Date.now();
      emitToPresenters(io, s, "leaderboard:updated", { entries: queued });
    }, LEADERBOARD_PUSH_MS - (now - st.lastAt));
  }
}

/** Drop a pending push — the room is gone, or something exact just replaced it. */
function cancelLeaderboardPush(s: LiveSession) {
  const st = leaderboardPushes.get(s.sessionId);
  if (st?.timer) clearTimeout(st.timer);
  leaderboardPushes.delete(s.sessionId);
  // The answered count rides the same lifecycle: nothing to count once the
  // deck has ended or the room is gone.
  answeredPushes.cancel(s.sessionId);
}

/**
 * A board row as the SERVER holds it, and as a presenter may see it: it names
 * the person.
 */
interface LeaderboardEntryRow {
  participantId: string;
  pkey: string;
  name: string;
  score: number;
  avatar: number;
}

/**
 * A board row as a PHONE may see it — the same row with the name of the seat
 * removed.
 *
 * Two types rather than an optional field, for the reason `leaderboardView`
 * and `stageLeaderboardView` are two fields rather than two keys on one
 * object: a shape a participant receives verbatim should be INCAPABLE of
 * carrying what a participant may not have. An optional `participantId?` would
 * compile everywhere and leak the first time somebody passed the wrong array.
 * This way the compiler refuses — which it already did, once, while this was
 * being written.
 */
type PublicLeaderboardRow = Omit<LeaderboardEntryRow, "participantId">;

/**
 * End the room — per socket, because the podium owes each phone one fact the
 * shared payload cannot carry.
 *
 * `entries` is capped at the public top ten, and that cap is not editorial:
 * every row carries a `participantId`, which is the whole of what
 * `participant:join` needs to assume somebody's identity and overwrite their
 * answers. So the board a phone receives must stay exactly as small as it is.
 *
 * But the client derived "where did I come?" by finding ITSELF in that board —
 * so everyone who finished 11th or below was shown a podium with no final
 * standing at all. The fix is not more rows; it is two scalars about the
 * receiving socket itself, which leak nothing about anybody else.
 *
 * Stamped per socket in the same way `qa:updated` is (qa.ts `broadcast`),
 * reading each socket's own `socket.data` rather than trusting anything in the
 * payload. Walking the room rather than `participantSockets` keeps the set of
 * recipients byte-identical to the `io.to(joinCode)` broadcast this replaced:
 * host windows are in the room too, and still get the event — with both
 * scalars null, since a presenter has no standing in its own quiz.
 */
async function emitSessionEnded(
  io: Server,
  joinCode: string,
  // The board every socket in the room receives, phones included — so it is
  // the public shape, with no `participantId` on any row.
  entries: PublicLeaderboardRow[],
  // Server-side only, for the rank lookup below. Never emitted.
  fullEntries: LeaderboardEntryRow[]
) {
  // Rank is positional over EVERYONE, 1-based — the same arithmetic
  // `participant:join`'s `myResult.rank` already uses, so a phone cannot be
  // told one position on reconnect and a different one on the podium.
  const standing = new Map<string, { rank: number; score: number }>();
  fullEntries.forEach((e, i) => standing.set(e.participantId, { rank: i + 1, score: e.score }));

  const sockets = await io.in(joinCode).fetchSockets();
  for (const sock of sockets) {
    const pid =
      sock.data?.role === "participant"
        ? (sock.data.participantId as string | undefined)
        : undefined;
    // Absent from the board means this person submitted nothing all session,
    // so there is no standing to report — null rather than an invented last
    // place among everyone else who also never played.
    const mine = pid ? standing.get(pid) : undefined;
    sock.emit("session:ended", {
      entries,
      myRank: mine?.rank ?? null,
      myScore: mine?.score ?? null,
      // How many people `myRank` is a rank among. A bare `#11` is a ranking;
      // `#11 of 34` is a result (PULSE T5). It is the length of the board the
      // rank was computed over — everyone who scored — so the two numbers
      // cannot disagree about who counts. A scalar about the room, not about
      // anybody in it; it leaks nothing.
      totalPlayers: fullEntries.length,
    });
  }
}

/**
 * May this phone be told how it did on this slide yet?
 *
 * The reveal embargo used to live entirely in the client's `FeedbackCard`, one
 * layer above the data: the submit ack returned the full graded result the
 * instant it was scored, with no reference to pacing and none to
 * `revealedSlides`. Since changing your answer is a supported feature, that
 * made the ack an answer-key oracle costing one round trip per probe — three
 * probes to the key on a four-option question, still scoring 965 of 1000,
 * while the honest player in the same room scored 0.
 *
 * Two pacings, two answers:
 *
 *   PRESENTER — the room shares one clock and one reveal, so there IS a later
 *   beat at which everyone learns the answer together. Withhold until it.
 *
 *   AUDIENCE — there is no shared reveal to wait for, by design (see
 *   `armRevealTimer`, and N2: giving self-paced decks one locked the deck for
 *   everyone behind the first player through it). A self-paced player's result
 *   card is the only feedback they will ever get, so it goes out immediately
 *   and unchanged. The key is theirs alone: they have already answered, and
 *   nobody else is on their clock.
 */
function embargoed(s: LiveSession, slideId: string): boolean {
  return s.pacing === "PRESENTER" && !s.revealedSlides.has(slideId);
}

/** What a phone is told about ITS OWN answer. One spelling, four senders. */
interface MyResult {
  isQuiz: true;
  correct: boolean;
  points: number;
  totalScore: number;
  rank: number;
}

/**
 * Send a `slide:reveal` frame to the room, stamped per socket with that
 * phone's own graded result.
 *
 * The reveal is the beat at which a player is ENTITLED to know how they did —
 * and under presenter pacing it is now the first such beat, because the submit
 * ack no longer carries the grade (see `participant:submit`). So the frame that
 * lifts the embargo has to deliver what the embargo withheld, or a player who
 * answered correctly is simply never told.
 *
 * Per socket, in the same room walk `emitSessionEnded` uses and for the same
 * reason: `myResult` is a fact about the receiver, so it cannot ride on a
 * shared payload. Presenters get `myResult: null` — a host has no standing in
 * its own quiz — and the rest of the frame byte-identical to the room's, so the
 * stage cannot drift from the phones.
 */
async function emitRevealFrame(io: Server, joinCode: string, s: LiveSession, payload: any) {
  const slideId: string | undefined = payload?.slideId;
  const slide = slideId ? s.slides.find((x) => x.id === slideId) : undefined;
  const scored = !!slide && isTimed(slide.type, slide.config);

  const graded = new Map<string, { correct: boolean; points: number }>();
  const standing = new Map<string, { rank: number; score: number }>();
  if (scored && slideId) {
    const rows = await prisma.response.findMany({
      where: { sessionId: s.sessionId, slideId },
      select: { participantId: true, correct: true, points: true },
    });
    for (const r of rows) graded.set(r.participantId, { correct: r.correct, points: r.points });
    const { fullEntries } = await computeLeaderboard(s);
    fullEntries.forEach((e, i) => standing.set(e.participantId, { rank: i + 1, score: e.score }));
  }

  // One stamp for the whole broadcast: every recipient must be able to resolve
  // its countdown against the same instant, and reading the clock per socket
  // would hand the last phone in the loop a later "now" than the first.
  const serverNow = Date.now();
  const sockets = await io.in(joinCode).fetchSockets();
  for (const sock of sockets) {
    const pid =
      sock.data?.role === "participant"
        ? (sock.data.participantId as string | undefined)
        : undefined;
    const mine = pid ? graded.get(pid) : undefined;
    const where = pid ? standing.get(pid) : undefined;
    const myResult: MyResult | null = mine
      ? {
          isQuiz: true,
          correct: mine.correct,
          points: mine.points,
          totalScore: where?.score ?? 0,
          rank: where?.rank ?? 0,
        }
      : null;
    sock.emit("slide:reveal", { ...payload, serverNow, myResult });
  }
}

// Reveal a quiz slide to the whole room: broadcast the correct answer(s) and the
// current aggregate, then refresh the presenter's leaderboard. One-shot per slide
// (tracked via revealedSlides) — happens on time-up or once everyone has answered.
async function revealSlide(io: Server, joinCode: string, slide: LiveSession["slides"][number]) {
  const s = live.get(joinCode);
  if (!s) return;
  s.revealedSlides.add(slide.id);
  s.revealedAtMono.set(slide.id, monoNow());
  // A reveal is irreversible, so it is session state rather than UI state: a
  // room rebuilt after a restart must not re-open a question the audience has
  // already been shown the answer to.
  await persistRevealed(s);

  const responses = await prisma.response.findMany({
    where: { sessionId: s.sessionId, slideId: slide.id },
    select: { participantId: true, value: true },
  });
  const aggregate = computeAggregate(slide.type, slide.config, responses);

  // This is the one sanctioned path by which an answer key reaches
  // participants — the slide module decides what that means for its type.
  const payload = {
    slideId: slide.id,
    aggregate,
    ...revealPayload(slide.type, slide.config),
  };
  // Keep the frame so a late joiner or a revisit can be told the question is
  // closed with exactly what the room already saw, rather than nothing.
  s.revealPayloads.set(slide.id, payload);
  await emitRevealFrame(io, joinCode, s, payload);

  // A reveal is the beat immediately before the host calls up the standings,
  // so this is the board the bar race will run from: pushed immediately, at
  // stage scope, so the climb has somewhere to climb from.
  const { stageEntries } = await computeLeaderboard(s);
  sendLeaderboardToPresenter(io, s, stageEntries, true);
}

// ---------------------------------------------------------------------------
// Restart recovery
// ---------------------------------------------------------------------------
//
// `live` is process memory. A redeploy, a crash or an `npm start` empties it
// while every row it described survives — the session is still ACTIVE, still
// has a currentSlideId, still owns its scored responses — and before this,
// nothing could ever reach that state again: `resume-session` scanned only the
// map, so the recovery path could not see a session it had not itself created.
// The host's only move was a new session with a new join code that every phone
// in the room had to re-type, and the evidence that this had happened over and
// over was 330 ACTIVE/LOBBY rows in the dev database that nothing would ever
// close.
//
// So the map stops being the source of truth and becomes a cache of it. Any
// path that needs a room — the host resuming, a phone re-joining, a presenter
// command, a submit — resolves it through `loadLive`, which rebuilds the entry
// from the database on a miss. The join code does not change, which is the
// whole point: the room comes back to the phones rather than the phones having
// to be sent somewhere new.
//
// What is reconstructable, and from where:
//   * the deck and the slide on screen  -> Session.currentSlideId + Slide rows
//   * who is in the room, with names    -> Participant rows (see schema)
//   * scores and answers                -> Response rows (already durable)
//   * which questions are closed        -> Session.revealedSlideIds
//   * how long the open question has run-> Session.currentSlideStartedAt
// Only the live sockets are genuinely gone, and those come back by themselves.

let ioRef: Server | null = null;

/** Concurrent misses on the same code must not build two rival rooms. */
const rehydrating = new Map<string, Promise<LiveSession | null>>();

function emptyLiveShell(): Pick<
  LiveSession,
  | "revealTimer"
  | "revealedSlides"
  | "revealedAtMono"
  | "revealPayloads"
  | "participantSockets"
  | "presenterSockets"
  | "audienceArrivals"
  | "slideCohort"
  | "outageCredits"
  | "lastHeardFrom"
  | "publicKeys"
  | "leaderboardView"
  | "stageLeaderboardView"
  | "navChain"
  | "lastActivityAt"
  | "endedAtMs"
> {
  return {
    revealTimer: null,
    revealedSlides: new Set(),
    revealedAtMono: new Map(),
    revealPayloads: new Map(),
    participantSockets: new Map(),
    presenterSockets: new Set(),
    audienceArrivals: new Map(),
    slideCohort: { slideId: null, ids: new Set() },
    outageCredits: new Map(),
    lastHeardFrom: new Map(),
    publicKeys: new Map(),
    leaderboardView: null,
    stageLeaderboardView: null,
    navChain: Promise.resolve(),
    lastActivityAt: Date.now(),
    endedAtMs: null,
  };
}

/**
 * The live room for a join code, rebuilt from the database if this process has
 * never seen it. Returns null only when no such session exists at all.
 */
async function loadLive(joinCode: unknown): Promise<LiveSession | null> {
  if (typeof joinCode !== "string" || !joinCode) return null;
  const hit = live.get(joinCode);
  if (hit) return hit;
  const inflight = rehydrating.get(joinCode);
  if (inflight) return inflight;
  const p = rehydrateSession(joinCode).finally(() => rehydrating.delete(joinCode));
  rehydrating.set(joinCode, p);
  return p;
}

async function rehydrateSession(joinCode: string): Promise<LiveSession | null> {
  const row = await prisma.session.findUnique({
    where: { joinCode },
    include: {
      presentation: {
        // Same rule as create-session: a tombstoned slide is not part of the
        // deck, so a recovered room must not serve one either.
        include: { slides: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
      },
      participants: { select: { participantId: true, name: true, avatar: true } },
    },
  });
  if (!row) return null;
  // Someone else finished first while we were in the database.
  const raced = live.get(joinCode);
  if (raced) return raced;

  const slides = row.presentation.slides.map((sl) => ({
    id: sl.id,
    type: sl.type,
    question: sl.question,
    config: safeParse(sl.config),
    order: sl.order,
  }));

  // Where the room was standing. A currentSlideId that no longer resolves means
  // the slide was deleted while the process was down; seat the room on the
  // first surviving slide rather than yanking it back to the lobby, which would
  // look to every phone like the session had been abandoned.
  let currentIndex = -1;
  if (row.currentSlideId) {
    const i = slides.findIndex((sl) => sl.id === row.currentSlideId);
    currentIndex = i >= 0 ? i : slides.length > 0 ? 0 : -1;
  }
  const status: LiveSession["status"] =
    row.status === "ENDED" ? "ENDED" : currentIndex >= 0 ? "ACTIVE" : "LOBBY";

  const s: LiveSession = {
    ...emptyLiveShell(),
    sessionId: row.id,
    presentationId: row.presentationId,
    ownerId: row.presentation.ownerId,
    pacing: row.presentation.pacing === "AUDIENCE" ? "AUDIENCE" : "PRESENTER",
    filterMode: (row.presentation.filterMode as FilterMode) ?? "mask",
    timeScale: clampTimeScale(row.presentation.timeScale),
    slides,
    currentIndex,
    status,
    // Nobody is CONNECTED yet — their sockets died with the old process — but
    // everyone who was ever here is known, so scores resolve to people from the
    // first frame after recovery rather than to "Anonymous".
    participants: new Map(),
    roster: new Map(row.participants.map((p) => [p.participantId, { name: p.name, avatar: p.avatar }])),
    presenterSocketId: null,
    currentSlideStartedAt: null,
    currentSlideStartedMono: null,
    endedAtMs: row.endedAt ? row.endedAt.getTime() : null,
  };

  for (const id of parseIdList(row.revealedSlideIds)) s.revealedSlides.add(id);

  // Put the open question back on the clock it was already running. Without
  // this the choice is between restarting every countdown — a second full-speed
  // scoring window for everyone — and scoring against nothing.
  if (currentIndex >= 0 && row.currentSlideStartedAt) {
    const startedWall = row.currentSlideStartedAt.getTime();
    s.currentSlideStartedAt = startedWall;
    s.currentSlideStartedMono = monoFromWall(startedWall, Date.now(), monoNow());
  }

  // Put every self-paced player back on their OWN clock.
  //
  // The shared clock restored above is the whole story for a presenter-paced
  // deck and none of it for a self-paced one, where each player's window opened
  // whenever they personally reached the slide. Without this the Map comes back
  // empty and stays empty — a reconnecting phone is deliberately not re-seated
  // under audience pacing, because it owns its own position — so every correct
  // answer in the room scores a flat 1000 (see the AudienceArrival model).
  //
  // Only for AUDIENCE decks: a presenter-paced room never writes these rows, so
  // reading them would be a query that can only ever return nothing.
  if (s.pacing === "AUDIENCE") {
    const slideIds = new Set(slides.map((sl) => sl.id));
    const arrivals = await prisma.audienceArrival.findMany({
      where: { sessionId: row.id },
      select: { participantId: true, slideId: true, arrivedAt: true },
    });
    const nowWall = Date.now();
    const nowMono = monoNow();
    for (const a of arrivals) {
      // A slide deleted while the process was down is not part of this deck any
      // more, and seating a clock on it would leave an entry nothing can ever
      // match or clear.
      if (!slideIds.has(a.slideId)) continue;
      // The same conversion `currentSlideStartedMono` uses, for the same
      // reason: monotonic time counts from THIS process's start, so a stored
      // wall clock has to be walked back onto the new scale. Clamped at 0 so a
      // row stamped in the future (a clock step between processes) can only
      // ever read as "just now" rather than as a negative elapsed.
      s.audienceArrivals.set(arrivalKey(a.participantId, a.slideId), {
        slideId: a.slideId,
        mono: monoFromWall(a.arrivedAt.getTime(), nowWall, nowMono),
      });
    }
  }

  // Rebuild the exact frames a reveal left behind, so a phone that re-joins
  // onto a closed question is told it is closed instead of being handed a
  // ticking clock it can never beat. The aggregate is recomputed from the rows,
  // which is faithful: the question is shut, so no answer can still arrive.
  const revealedIds = [...s.revealedSlides].filter((id) => slides.some((sl) => sl.id === id));
  if (revealedIds.length > 0) {
    const responses = await prisma.response.findMany({
      where: { sessionId: row.id, slideId: { in: revealedIds } },
      select: { slideId: true, participantId: true, value: true },
    });
    const bySlide = new Map<string, { participantId: string; value: string }[]>();
    for (const r of responses) {
      const list = bySlide.get(r.slideId) ?? [];
      list.push({ participantId: r.participantId, value: r.value });
      bySlide.set(r.slideId, list);
    }
    for (const id of revealedIds) {
      const slide = slides.find((sl) => sl.id === id)!;
      s.revealPayloads.set(id, {
        slideId: id,
        aggregate: computeAggregate(slide.type, slide.config, bySlide.get(id) ?? []),
        ...revealPayload(slide.type, slide.config),
      });
    }
  }

  live.set(joinCode, s);

  // Seat the early-reveal quorum on the slide the room came back to, with
  // nobody in it: every socket died with the old process, so the room is
  // waiting for people who have not reconnected yet. Each `participant:join`
  // adds itself back. Without this the cohort would point at no slide at all
  // and the early reveal would stay switched off until the host navigated.
  resetCohort(s, currentIndex >= 0 ? s.slides[currentIndex].id : null);

  // Re-arm the auto-reveal with what is LEFT of the window, not a fresh one. If
  // the time ran out while the process was down, this fires straight away and
  // the question closes honestly rather than re-opening.
  if (ioRef && status !== "ENDED") {
    const remaining =
      s.currentSlideStartedAt !== null
        ? scaledLimit(s, s.slides[currentIndex]) * 1000 - (Date.now() - s.currentSlideStartedAt)
        : undefined;
    armRevealTimer(ioRef, joinCode, s, remaining);
  }

  console.log(
    `[recover] rebuilt session ${joinCode} from the database ` +
      `(status=${status} index=${currentIndex} roster=${s.roster.size} revealed=${s.revealedSlides.size})`
  );
  return s;
}

/**
 * Arm the time-up auto-reveal for whatever slide is on screen. One place, so
 * the fresh-navigation case and the recovered-mid-question case cannot drift.
 */
function armRevealTimer(io: Server, joinCode: string, s: LiveSession, remainingMs?: number) {
  if (s.revealTimer) {
    clearTimeout(s.revealTimer);
    s.revealTimer = null;
  }

  // AUDIENCE pacing never auto-reveals. A reveal is a SHARED moment -- one
  // room-wide frame that closes a question for everyone at once -- and in a
  // self-paced deck there is no shared moment to synchronise to, because at
  // any instant different people are on different slides.
  //
  // What it did instead was punish the slowest reader. A host pressing Next
  // once armed a 20s timer on slide 3; twenty seconds later the answer landed
  // on the screen of everyone still reading slide 3, closed it against them,
  // and pre-spoiled it for everyone who had not reached it yet. That is the
  // exact axis `timeScale` (relaxed timing) exists to protect.
  //
  // Not fixed by making the reveal per-player: the lockout and the broadcast
  // have to move together, or a player sees the key and can still submit.
  // Deleting the shared reveal here is the smaller, coherent change --
  // per-player clocks still score speed (see `audienceArrivals`), and the
  // room still watches results grow live on the projector.
  if (s.pacing === "AUDIENCE") return;

  const idx = s.currentIndex;
  if (idx < 0 || idx >= s.slides.length) return;
  const slideObj = s.slides[idx];
  if (s.revealedSlides.has(slideObj.id)) return;
  if (!isTimed(slideObj.type, slideObj.config)) return;
  const ms = remainingMs ?? scaledLimit(s, slideObj) * 1000;
  s.revealTimer = setTimeout(() => revealSlide(io, joinCode, slideObj), Math.max(0, ms));
}

/**
 * Everyone the early reveal has to hear from before it may close a question.
 *
 * Reset when the room lands on a new slide, and only ever ADDED to while that
 * slide is up: by a navigation (everyone present at the time), by a join
 * (someone arriving mid-question) and by a submission. Measuring the quorum
 * against a set that can only grow is the whole point — `participants` shrinks
 * the instant a phone locks, and that shrinkage is what let one player's answer
 * close the question for a room that was still typing.
 */
function resetCohort(s: LiveSession, slideId: string | null) {
  s.slideCohort = { slideId, ids: new Set(slideId ? s.participants.keys() : []) };
}

function joinCohort(s: LiveSession, participantId: string, slideId: string | null) {
  if (!slideId || s.slideCohort.slideId !== slideId) return;
  s.slideCohort.ids.add(participantId);
}

function parseIdList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Note that a player has arrived at a slide, which starts THEIR clock on it.
 *
 * First arrival only, and keyed per (player, slide). Re-stamping would make the
 * clock resettable at will — leave and come back, or page away and back, and
 * the window reopens at full speed — which is a worse scoring bug than the one
 * this fixes.
 */
function arrivalKey(participantId: string, slideId: string) {
  return `${participantId}\u0000${slideId}`;
}

function markArrival(s: LiveSession, participantId: string, slideId: string | null) {
  if (s.pacing !== "AUDIENCE" || !slideId) return;
  const key = arrivalKey(participantId, slideId);
  if (s.audienceArrivals.has(key)) return;
  s.audienceArrivals.set(key, { slideId, mono: monoNow() });

  // ...and on disk, because the Map dies with the process and this is the only
  // clock a self-paced score can be measured against. See the AudienceArrival
  // model for what its loss cost (a flat 1000 to every correct answer in the
  // room, after any restart).
  //
  // Fire-and-forget, deliberately. The in-memory stamp above is what THIS
  // process grades on, and it is already correct; the row only matters to a
  // process that does not exist yet. Awaiting it would put a database round
  // trip in front of a navigation the player is waiting on, to protect against
  // a restart that probably will not happen — the wrong trade on the hot path.
  //
  // `createMany` with `skipDuplicates` rather than `create`: first-arrival-only
  // is enforced by the Map above, but two sockets for one identity can race
  // through it, and a unique-constraint rejection on a fire-and-forget write is
  // an unhandled rejection. This makes the second write a no-op instead, which
  // is also the semantics we want — the EARLIEST arrival is the true one.
  const wall = new Date();
  prisma.audienceArrival
    .createMany({
      data: [{ sessionId: s.sessionId, participantId, slideId, arrivedAt: wall }],
      skipDuplicates: true,
    })
    .catch((e) => {
      // Never fatal. A lost row costs this player their speed clock on this
      // slide IF the process also restarts before they answer; it must not cost
      // them the navigation they are in the middle of.
      console.error("[markArrival] could not persist arrival", e);
    });
}

/**
 * The moment the submitting player's clock on this slide started, on the
 * monotonic scale. In presenter pacing that is when the host put the slide up;
 * in audience pacing it is when THAT player reached it, because there is no
 * shared moment to measure from. Null means "no clock" — speedPoints then
 * treats the answer as instant, which is the right way to fail: a player is
 * never charged for a clock the server could not account for.
 */
function scoringStartedAt(s: LiveSession, participantId: string, slideId: string): number | null {
  if (s.pacing !== "AUDIENCE") return s.currentSlideStartedMono;
  const mono = s.audienceArrivals.get(arrivalKey(participantId, slideId))?.mono;
  if (mono === undefined) {
    // The fail-safe below is deliberate and stays, but it must not be SILENT.
    // A null here means this answer is about to be graded as instant and score
    // full marks, and for a year the only evidence was a leaderboard nobody
    // could explain. If this line appears for a whole room at once, arrivals
    // did not survive a restart; if it appears for one player, they reached a
    // slide by a path that does not mark arrivals.
    console.warn(
      `[scoringStartedAt] no arrival for participant=${participantId} slide=${slideId} ` +
        `session=${s.sessionId} — grading as instant (full speed points)`
    );
    return null;
  }
  return mono;
}

/**
 * The same arrival, expressed on the wall clock the wire speaks. Monotonic time
 * is meaningless to a browser — it counts from this process's start — so it is
 * converted at the boundary rather than leaked.
 */
function arrivalWallClock(s: LiveSession, participantId: string, slideId: string): number | null {
  const mono = s.audienceArrivals.get(arrivalKey(participantId, slideId))?.mono;
  // Rounded: `performance.now()` is fractional and a wall-clock millisecond
  // with a decimal tail is not a thing any client should have to parse.
  return mono === undefined ? null : Math.round(Date.now() - (monoNow() - mono));
}

// ---------------------------------------------------------------------------
// Outage credit — paying back the speed points a delivery gap cost
// ---------------------------------------------------------------------------
//
// An answer tapped while the phone was offline is delivered when the link
// comes back, and grading it at delivery charged the player for a network they
// do not control: 983 points earned, 827 awarded, for twelve seconds of dead
// Wi-Fi. The only party that knows when the tap happened is the client, and
// `clientTapAt` is therefore attacker-controlled — a scripted client claiming
// it tapped the instant the question opened would otherwise mint itself a
// perfect score on every question.
//
// THE TRUST DECISION. The client's claim never grants points on its own. The
// server grants a refund it can justify from ITS OWN measurement — how long
// this phone was out of contact — and the client's claim can only make that
// refund SMALLER. In full:
//
//   1. Evidence first. A refund exists only when the server measured a gap:
//      this identity re-joined on a NEW socket, and we know when we last heard
//      from the old one. No gap, no refund — so a healthy scripted client
//      claiming `clientTapAt === slideStartedAt` is graded at arrival exactly
//      as it is today, and gains nothing at all.
//   2. The claim can only shrink it. The refund is `min(measured gap, the
//      delay the client actually claims, the elapsed time on the question)`.
//      Claiming an earlier tap than the gap can explain buys nothing.
//   3. Hard ceiling. Capped at OUTAGE_CREDIT_CAP_MS regardless, so no
//      measurement error can refund a whole question.
//   4. Single use, short-lived. The credit is consumed by the first submission
//      after the reconnect and expires in OUTAGE_CREDIT_TTL_MS — long enough
//      for the retry queue's flush (3 retries × 500 ms), far too short to bank.
//
// WHAT THIS STILL ALLOWS, stated plainly: a player who deliberately kills
// their connection, thinks for N seconds, reconnects and claims they tapped at
// the start can recover up to N seconds of speed bonus, bounded by the cap.
// That is the irreducible residue of trusting any client clock at all, and it
// is not free — they must really be disconnected for that long (so the answer
// window can close under them, and a presenter-paced reveal rejects them
// outright with TOO_LATE), and every reconnect is visible server-side. The
// alternative was to charge every honest player on venue Wi-Fi for the outage,
// which is the defect this fixes and the far more common event.
//
// Note on skew: `clientTapAt` is read on the phone's own clock, which may be
// wrong (that is finding N10). A phone running FAST claims a later delay than
// it really used and is refunded less — it fails safe. Every frame carrying
// `startedAt` now also carries `serverNow` precisely so the phone can correct
// itself before sending.
const OUTAGE_CREDIT_CAP_MS = Number(process.env.OUTAGE_CREDIT_CAP_MS ?? 30_000);
const OUTAGE_CREDIT_TTL_MS = Number(process.env.OUTAGE_CREDIT_TTL_MS ?? 15_000);

/**
 * How long this identity was out of contact, measured by the server.
 *
 * Called from `participant:join` BEFORE `participantSockets` is re-pointed, so
 * `prev` is still the socket that owned this identity. Evidence is a socket
 * CHANGE: the same socket re-announcing itself (which the client does on every
 * `connect`, and a second tab does routinely) is not an outage. The reference
 * point is the last packet we actually received — Socket.IO's own heartbeat
 * keeps that fresh without the client sending anything — falling back to what
 * the disconnect handler recorded when the old socket is already gone.
 */
function measureOutage(io: Server, s: LiveSession, participantId: string, socketId: string): number {
  const prev = s.participantSockets.get(participantId);
  if (prev === socketId) return 0; // same socket: nothing dropped
  let lastHeard: number | undefined;
  if (prev) {
    const prevSock = io.sockets.sockets.get(prev);
    lastHeard = (prevSock?.data?.lastPacketAt as number | undefined) ?? s.lastHeardFrom.get(participantId);
  } else {
    // No socket registered: their last one disconnected and was evicted.
    lastHeard = s.lastHeardFrom.get(participantId);
  }
  if (typeof lastHeard !== "number") return 0; // never seen before — a fresh join
  return Math.max(0, Date.now() - lastHeard);
}

/** Take the credit this reconnect earned, if any. One submission, then gone. */
function consumeOutageCredit(s: LiveSession, participantId: string): number {
  const c = s.outageCredits.get(participantId);
  if (!c) return 0;
  s.outageCredits.delete(participantId);
  return Date.now() > c.expiresAt ? 0 : c.creditMs;
}

/** Reveals are one-shot and irreversible, so they belong in the row. */
async function persistRevealed(s: LiveSession) {
  await prisma.session
    .updateMany({
      where: { id: s.sessionId },
      data: { revealedSlideIds: JSON.stringify([...s.revealedSlides]) },
    })
    .catch((e) => console.error("could not persist reveal state", e));
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

// An ended room is kept briefly so stragglers still get a real answer, then
// dropped — `live.delete` used to be reachable from exactly one place (a deck
// deleted under a running room), so every session a process ever ran stayed in
// memory for the life of that process. Eviction is only safe now that a miss
// rebuilds from the database; before this change, dropping an entry destroyed
// the room.
const ENDED_RETENTION_MS = Number(process.env.ENDED_RETENTION_MS ?? 5 * 60_000);
// A host who closes the tab without ending leaves a room nobody will ever
// touch again. It is NOT ended — the data must stay exactly as it is — but
// there is no reason to hold the slide snapshot in memory, which for a
// 200-slide deck is several megabytes.
const IDLE_EVICT_MS = 6 * 3_600_000;
// How long a session has to have been open before an unattended process
// considers it abandoned rather than simply long. Deliberately generous: this
// must never close a room that is merely riding out a restart, which is the
// failure it exists to clean up after.
const STALE_SESSION_MS = Number(process.env.STALE_SESSION_HOURS ?? 12) * 3_600_000;

function reapLive() {
  const now = Date.now();
  for (const [code, s] of live) {
    const endedLongEnough = s.endedAtMs !== null && now - s.endedAtMs > ENDED_RETENTION_MS;
    const idle = now - s.lastActivityAt > IDLE_EVICT_MS;
    if (!endedLongEnough && !idle) continue;
    if (s.revealTimer) {
      clearTimeout(s.revealTimer);
      s.revealTimer = null;
    }
    cancelLeaderboardPush(s);
    live.delete(code);
  }
}

/**
 * Close sessions a long-dead process left open.
 *
 * These are rooms that were ACTIVE or in the LOBBY when something restarted,
 * before recovery existed. Their data is untouched — the responses, the roster
 * and the slide pointer all stay — but the row stops claiming to be live and
 * gets an honest `endedAt`: the last thing that actually happened in it, which
 * is what history and duration reporting should read. Closing is not erasing.
 */
async function closeStaleSessions() {
  const cutoff = new Date(Date.now() - STALE_SESSION_MS);
  const stale = await prisma.session.findMany({
    where: { status: { not: "ENDED" }, startedAt: { lt: cutoff } },
    select: { id: true, joinCode: true, startedAt: true },
  });
  // Never touch a room this process is currently serving, however old it is.
  const inUse = new Set([...live.values()].map((s) => s.sessionId));
  const targets = stale.filter((row) => !inUse.has(row.id));
  if (targets.length === 0) return;

  const lastActivity = await prisma.response.groupBy({
    by: ["sessionId"],
    where: { sessionId: { in: targets.map((t) => t.id) } },
    _max: { createdAt: true },
  });
  const endedAtFor = new Map(lastActivity.map((r) => [r.sessionId, r._max.createdAt]));
  for (const row of targets) {
    await prisma.session.updateMany({
      where: { id: row.id, status: { not: "ENDED" } },
      data: { status: "ENDED", endedAt: endedAtFor.get(row.id) ?? row.startedAt },
    });
  }
  console.log(`[reconcile] closed ${targets.length} session(s) abandoned by an earlier process`);
}

/**
 * Wire the module to the server. Called once at boot — the per-socket handler
 * registration below cannot do this, because recovery and housekeeping have to
 * work with no socket in sight.
 */
/**
 * How many rooms this process is holding in memory. Exposed on /api/health so
 * the retention above is observable rather than a claim — "the map never
 * shrinks" was true for a long time and nothing on the outside could tell.
 */
export function liveSessionCount(): number {
  return live.size;
}

export function initSessionRuntime(io: Server) {
  ioRef = io;
  closeStaleSessions().catch((e) => console.error("startup reconciliation failed", e));
  // Overridable so the eviction can actually be exercised rather than taken on
  // trust — and so an operator can tighten it on a memory-constrained box.
  const every = Number(process.env.LIVE_REAP_INTERVAL_MS ?? 10 * 60_000);
  const timer = setInterval(() => {
    reapLive();
    closeStaleSessions().catch((e) => console.error("reconciliation failed", e));
  }, every);
  timer.unref();
}

export function registerSessionHandlers(io: Server, socket: Socket) {
  ioRef = io;

  // When we last heard anything at all from this socket. Engine.IO's heartbeat
  // keeps it fresh — a phone sitting silently reading a question still answers
  // the server's pings — so a gap here is a gap in the NETWORK, not in the
  // player's attention. It is the server-side evidence `measureOutage` needs
  // before a client's claim about when it tapped can be worth any points.
  socket.data.lastPacketAt = Date.now();
  socket.conn.on("packet", () => {
    socket.data.lastPacketAt = Date.now();
  });

  // ---- The clock probe ----
  //
  // Every countdown in this app is `startedAt + limit - now`, where `startedAt`
  // is OUR clock and `now` is the client's. The difference between those two
  // clocks is the one term neither side can see, so each frame that carries
  // `startedAt` also carries `serverNow` and the client subtracts its own
  // offset out. That works, but it only ever samples on frames the room
  // happens to send: a phone that joins and then sits reading for ten minutes
  // never re-measures, and a sample that arrives on a congested link is
  // one-way-latency stale with no way to tell how stale.
  //
  // This is the same stamp, on demand, as a round trip the caller TIMES. With
  // `rtt` in hand the client can place the stamp in the middle of the trip
  // instead of at the end, and — far more useful — it can compare two samples
  // and keep the one that travelled through less queueing. See
  // client/src/lib/serverClock.ts for the filter that does it.
  //
  // Deliberately unauthenticated and session-free: it reveals nothing but the
  // time, every client needs it before it has joined anything, and the
  // PRESENTER needs it too (its ring was reading the laptop's own clock). The
  // work is one `Date.now()` and a reply, so a client that spams it costs us
  // strictly less than the heartbeat it is already sending.
  socket.on("time:sync", (_payload: unknown, cb?: Function) => {
    cb?.({ serverNow: Date.now() });
  });

  // Q&A and reactions live in their own module but need to resolve the same
  // in-memory session map and reuse this file's presenter authorization.
  registerQaHandlers(io, socket, {
    sessionFor: async (joinCode) => {
      const s = await loadLive(joinCode);
      return s ? { sessionId: s.sessionId, ownerId: s.ownerId, filterMode: s.filterMode } : undefined;
    },
    isPresenter: async (payload) => {
      const s = await loadLive(payload?.joinCode);
      if (!s) return false;
      const auth = payload?.token ? verifyToken(payload.token) : null;
      return !!auth && auth.userId === s.ownerId;
    },
  });

  // Authorize a presenter command: the caller must supply a valid token whose
  // user owns this session. The join code alone is NOT sufficient — it's shown
  // on screen to every participant. On success we also refresh presenterSocketId
  // so presenter-only pushes (e.g. leaderboard:updated) survive a reconnect.
  //
  // Now resolves through `loadLive`, so a command that arrives at a process
  // which has never seen this room rebuilds it from the database instead of
  // answering SESSION_GONE against a session the row still calls ACTIVE. That
  // reattach-on-command behaviour is load-bearing for resume and is unchanged;
  // what changed is only where the room may be found.
  async function requirePresenter(payload: any, cb?: Function): Promise<LiveSession | null> {
    const s = await loadLive(payload?.joinCode);
    if (!s) {
      reject(cb, "SESSION_GONE", "Session not found");
      return null;
    }
    const auth = payload?.token ? verifyToken(payload.token) : null;
    if (!auth || auth.userId !== s.ownerId) {
      reject(cb, "UNAUTHORIZED", "Unauthorized");
      return null;
    }
    attachPresenter(s);
    s.lastActivityAt = Date.now();
    return s;
  }

  /**
   * Register this socket as one of the room's host windows and make it primary.
   *
   * The old code kept a single `presenterSocketId` and re-pointed it on every
   * command, so two tabs on one account traded ownership back and forth and the
   * loser silently dropped to the participant view — stripped answer key, no
   * results, no leaderboard — while still driving the room perfectly. Keeping
   * the full set means both windows stay correct; the primary pointer now only
   * says who pressed the last key, which is reported rather than acted on.
   */
  function attachPresenter(s: LiveSession) {
    const changed = s.presenterSocketId !== socket.id || !s.presenterSockets.has(socket.id);
    s.presenterSockets.add(socket.id);
    s.presenterSocketId = socket.id;
    if (changed && s.presenterSockets.size > 1) announcePresenters(io, s);
  }

  // ---- Presenter: create a live session from a presentation ----
  socket.on("presenter:create-session", async ({ token, presentationId }, cb) => {
    const auth = token ? verifyToken(token) : null;
    if (!auth) return reject(cb, "UNAUTHORIZED", "Unauthorized");

    const presentation = await prisma.presentation.findFirst({
      where: { id: presentationId, ownerId: auth.userId },
      // `deletedAt` is the deck's own "this slide is gone" marker — the row
      // survives only so finished sessions can still resolve their responses
      // (schema.prisma, Slide.deletedAt). A new session must never serve one,
      // or deleting a slide would remove it from the editor and nowhere else.
      include: { slides: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
    });
    if (!presentation) return reject(cb, "DECK_GONE", "Presentation not found");
    if (presentation.slides.length === 0) return reject(cb, "EMPTY_DECK", "Add a slide first");

    let joinCode = genJoinCode();
    while (await prisma.session.findUnique({ where: { joinCode } })) {
      joinCode = genJoinCode();
    }

    const session = await prisma.session.create({
      data: { presentationId, joinCode, status: "LOBBY" },
    });

    const liveSession: LiveSession = {
      ...emptyLiveShell(),
      sessionId: session.id,
      presentationId,
      ownerId: auth.userId,
      pacing: presentation.pacing === "AUDIENCE" ? "AUDIENCE" : "PRESENTER",
      filterMode: (presentation.filterMode as FilterMode) ?? "mask",
      timeScale: clampTimeScale(presentation.timeScale),
      slides: presentation.slides.map((s) => ({
        id: s.id,
        type: s.type,
        question: s.question,
        config: safeParse(s.config),
        order: s.order,
      })),
      currentIndex: -1,
      status: "LOBBY",
      participants: new Map(),
      roster: new Map(),
      presenterSocketId: socket.id,
      currentSlideStartedAt: null,
      currentSlideStartedMono: null,
    };
    liveSession.presenterSockets.add(socket.id);
    live.set(joinCode, liveSession);

    socket.join(joinCode);
    socket.data.joinCode = joinCode;
    socket.data.role = "presenter";

    cb?.({
      joinCode,
      sessionId: session.id,
      pacing: liveSession.pacing,
      presenterCount: liveSession.presenterSockets.size,
      theme: presentation.theme,
      // Speaker notes are presenter-only and never broadcast to the room.
      notes: presentation.slides.map((sl) => ({ id: sl.id, notes: sl.notes })),
      slideTitles: presentation.slides.map((sl) => sl.question),
      status: liveSession.status,
      totalSlides: liveSession.slides.length,
      currentIndex: liveSession.currentIndex,
      currentSlide: currentSlideOf(liveSession, true),
    });
  });

  // ---- Presenter: re-attach to a session this deck already has running ----
  // A presenter reload loses only the socket, not the session: the live entry,
  // the join code and every response still exist on the server. Without a way
  // back to them the host's only option is create-session, which mints a second
  // room the audience is not in and strands everyone in a deck nobody can drive.
  // The client must try this BEFORE create-session.
  socket.on("presenter:resume-session", async ({ token, presentationId }, cb) => {
    const auth = token ? verifyToken(token) : null;
    if (!auth) return reject(cb, "UNAUTHORIZED", "Unauthorized");

    // Same authorization rule as every other presenter command: ownership of
    // the session, never knowledge of the join code. If a deck somehow has more
    // than one live session, the newest is the one the host just left — `live`
    // iterates in insertion order, so the last match wins.
    let joinCode: string | null = null;
    let found: LiveSession | null = null;
    for (const [code, s] of live) {
      if (s.presentationId === presentationId && s.ownerId === auth.userId && s.status !== "ENDED") {
        joinCode = code;
        found = s;
      }
    }

    // Nothing in memory does NOT mean nothing is running. This process may
    // simply never have seen the room: a redeploy or a crash empties `live`
    // while the session row is still ACTIVE, still pointing at a slide, still
    // owning its scored responses. Scanning only the map is what made a restart
    // unrecoverable — the host's one route back could not see a session it had
    // not itself created, so the only option left was a new room with a new
    // join code that every phone had to re-type.
    //
    // Same ownership rule, same "newest wins" tie-break, now asked of the
    // database. The join code is deliberately the one the room already has.
    if (!found) {
      const row = await prisma.session.findFirst({
        where: {
          presentationId,
          status: { not: "ENDED" },
          presentation: { ownerId: auth.userId },
        },
        orderBy: { startedAt: "desc" },
        select: { joinCode: true },
      });
      if (row) {
        const recovered = await loadLive(row.joinCode);
        if (recovered && recovered.status !== "ENDED") {
          joinCode = row.joinCode;
          found = recovered;
        }
      }
    }
    if (!joinCode || !found) return reject(cb, "NO_LIVE_SESSION", "No live session to resume");

    found.lastActivityAt = Date.now();
    attachPresenter(found);
    socket.join(joinCode);
    socket.data.joinCode = joinCode;
    socket.data.role = "presenter";

    // Theme and speaker notes live only in the deck row — the live session does
    // not carry them — and a resumed stage with an empty notes panel is a
    // regression the host would notice immediately.
    const deck = await prisma.presentation.findFirst({
      where: { id: presentationId, ownerId: auth.userId },
      select: {
        theme: true,
        // Same rule as create-session: a tombstone is not part of the deck.
        slides: {
          where: { deletedAt: null },
          orderBy: { order: "asc" },
          select: { id: true, notes: true },
        },
      },
    });

    const idx = found.currentIndex;
    const current = currentSlideOf(found, true);
    // Same two fields, same names and same meaning as the `participant:join`
    // ack — a resume is a re-join, just for the host. Without them a reload on
    // an already-revealed slide puts the projector back into the pre-reveal
    // stage, and nothing corrects it until the host navigates away: the stored
    // reveal is only re-emitted by `goto`, which a resume does not call.
    const revealed = !!current && found.revealedSlides.has(current.id);

    cb?.({
      ok: true,
      joinCode,
      status: found.status,
      index: idx,
      totalSlides: found.slides.length,
      // The room itself. `participant:count` is emitted only on a join and a
      // disconnect, so a host who reloads reads "0 joined / 0 players ready"
      // in front of everyone who is still connected, and it does NOT heal
      // through navigation — only when somebody arrives or leaves. The lobby
      // IS the player list, so that is not a cosmetic zero: the host's
      // rational reading is that the resume failed, and the rational response
      // is End or a fresh session, which is exactly the data loss the resume
      // path exists to prevent. Same field names, same element shape as the
      // broadcast, so the client reduces both through one path. This is a
      // PRESENTER ack, so the rows keep their `participantId`.
      ...participantsPayload(found, true),
      // How many people this room has EVER had, which after a restart is the
      // only honest answer to "did the resume work". `count` above is live
      // sockets and is legitimately 0 for the few seconds before the phones
      // reconnect — a host reading that alone would conclude the resume failed
      // and start a fresh room, which is the exact data loss resume prevents.
      rosterSize: found.roster.size,
      // How many host windows are attached to this room, this one included.
      presenterCount: found.presenterSockets.size,
      // The presenter is the one party entitled to the answer key.
      currentSlide: current,
      revealed,
      // The stored frame is already the post-reveal one, so it carries whatever
      // the slide module exposes at reveal time — the presenter needs no
      // enriched variant, and keeping it byte-identical to what the room saw
      // means the stage cannot drift from the phones.
      reveal: revealed ? found.revealPayloads.get(current!.id) ?? null : null,
      startedAt: found.currentSlideStartedAt,
      // Paired with `startedAt` everywhere it appears — see `slide:changed`.
      serverNow: Date.now(),
      timeLimitSec:
        idx >= 0 && isTimed(found.slides[idx].type, found.slides[idx].config)
          ? scaledLimit(found, found.slides[idx])
          : null,
      // The host is as entitled to come back into the shared moment as a
      // phone is: standings are a broadcast with no state behind them, so a
      // reload while the scoreboard is up put the projector back on the slide
      // while every phone in the room still showed the board. Identical field
      // name and shape to the `participant:join` ack — one spelling of "the
      // standings are on screen", as with the roster above.
      // Stage-scoped, same field name and same `{ entries }` shape the phones
      // get — one spelling of "the standings are on screen", with the rows
      // each side is entitled to. `null` still means the board is down.
      leaderboardView: found.leaderboardView
        ? { entries: found.stageLeaderboardView ?? found.leaderboardView.entries }
        : null,
      // Not in the wire contract, but a resumed stage cannot render without
      // them and they are presenter-only in create-session too.
      sessionId: found.sessionId,
      pacing: found.pacing,
      theme: deck?.theme,
      notes: deck?.slides ?? [],
      slideTitles: found.slides.map((sl) => sl.question),
    });

    // Everything else the stage renders from pushes rather than from the ack.
    // A reload wipes all of it, and none of these events fire again until the
    // host navigates — so the resumed projector sat with a blank answer tally
    // and no leaderboard button on a slide that had both a moment earlier.
    // Re-push the same frames a navigation would, to this socket only: the
    // room's state has not changed, only the host's knowledge of it.
    // Presenter-shaped: this socket is the host window that just resumed.
    io.to(socket.id).emit("participant:count", participantsPayload(found, true));
    const resumedSlide = currentSlideOf(found);
    if (resumedSlide) await emitResults(io, joinCode, resumedSlide.id);
    const { stageEntries } = await computeLeaderboard(found);
    sendLeaderboardToPresenter(io, found, stageEntries, true);
  });

  // The session row is gone (its deck was deleted mid-run). Drop the live
  // entry and tell the room, rather than carrying on against nothing. Shared
  // by both callers so the no-op path reports a dead deck the same way a real
  // move does — the host must not get a different story depending on which
  // key they happened to press.
  function sessionVanished(joinCode: string, cb?: Function) {
    live.delete(joinCode);
    // No board and no standings: the session row is gone, so there is nothing
    // to rank anyone against. Same event, same shape, both scalars null.
    //
    // Not awaited — both callers are telling the HOST its deck has vanished and
    // that refusal must not wait on a room walk. The two land on different
    // sockets, so nothing observes the order. Failures are swallowed loudly
    // rather than left to the process-level handler: a room we could not reach
    // is already gone.
    emitSessionEnded(io, joinCode, [], []).catch((err) =>
      console.error("[session:ended] failed to notify room", joinCode, err)
    );
    reject(cb, "SESSION_GONE", "This session no longer exists");
  }

  // ---- Presenter: navigate slides (used by goto / next / prev) ----
  // Callers must authorize via requirePresenter and pass the resolved session.
  // The destination arrives as a FUNCTION, not a number, because it can only
  // be resolved once the deck has been reconciled below — see `navigate`.
  async function goto(s: LiveSession, joinCode: string, target: NavTarget, cb?: Function) {
    // An ENDED deck has already shown everyone the podium. Driving it again
    // pulls the room back into questions whose submit path is closed, so they
    // would see a live countdown they can never answer.
    if (s.status === "ENDED") {
      reject(cb, "SESSION_ENDED", "Session has ended");
      return;
    }

    // Drop any slide that has been deleted from the deck since the snapshot was
    // taken — otherwise the next press walks the room onto a question whose row
    // no longer exists and whose every submit fails. A non-null `vacancy` means
    // the slide ON SCREEN is the one that vanished, which must be broadcast
    // even if the index arithmetic below happens to land on the same number.
    const vacancy = await reconcileDeletedSlides(s);

    // Only now is the destination knowable. A relative move has to count from
    // the pruned deck and from the vacancy the deleted slide left, so the
    // target is resolved HERE rather than by the caller: resolving it first
    // measured Next against the index the prune had just re-seated, which
    // silently skipped the slide the room was moved onto.
    const clamped = Math.max(-1, Math.min(target(s, vacancy), s.slides.length - 1));

    // Re-entering the slide we are already on is a no-op, not a replay.
    // Falling through here would restart `currentSlideStartedAt` and re-arm the
    // auto-reveal, which resets the ring for the whole room on a stray clicker
    // press and — because speed points grade off `startedAt` — hands everyone a
    // fresh full-speed scoring window.
    if (clamped === s.currentIndex && vacancy === null) {
      // A no-op still has to notice the session has been deleted out from
      // under us. The deleted-deck detector is `count === 0` on the write
      // further down, and on the LAST slide every `next` clamps to the current
      // index and returns here — so the host could press Next forever against
      // a dead deck and neither they nor the room would ever be told. Re-assert
      // the row we already believe in: identical values, so it is a genuine
      // no-op where the row exists, and the one thing we want out of it is
      // the count.
      const stillAlive = await prisma.session.updateMany({
        where: { id: s.sessionId },
        data: {
          status: s.status,
          currentSlideId: currentSlideOf(s)?.id ?? null,
          currentSlideStartedAt:
            s.currentSlideStartedAt === null ? null : new Date(s.currentSlideStartedAt),
        },
      });
      if (stillAlive.count === 0) {
        sessionVanished(joinCode, cb);
        return;
      }
      cb?.({ ok: true, index: s.currentIndex, currentSlide: currentSlideOf(s, true) });
      return;
    }

    // Leaving whatever slide we were on: always cancel a pending auto-reveal.
    if (s.revealTimer) {
      clearTimeout(s.revealTimer);
      s.revealTimer = null;
    }
    // Standings belong to the slide they were called up on. Navigating is the
    // host putting the deck back on screen, so a phone that re-joins after this
    // must be seated at the slide, not at a scoreboard nobody is looking at.
    s.leaderboardView = null;
    s.stageLeaderboardView = null;

    s.currentIndex = clamped;
    s.status = clamped < 0 ? "LOBBY" : "ACTIVE";
    // Two readings of the same instant: the wall clock goes on the wire and
    // into the row (clients and rows both speak wall time, and only wall time
    // survives a restart); the monotonic one is what scoring reads, so a clock
    // step can no longer move the score without moving the deadline.
    s.currentSlideStartedAt = clamped >= 0 ? Date.now() : null;
    s.currentSlideStartedMono = clamped >= 0 ? monoNow() : null;

    const slide = currentSlideOf(s);

    // In audience pacing the host's navigation is also the moment everyone
    // present arrives, for those who have not moved themselves yet.
    if (slide) for (const pid of s.participants.keys()) markArrival(s, pid, slide.id);

    // A new slide, a new quorum. Everyone connected at this instant is who the
    // early reveal has to wait for; a phone that locks later cannot shorten
    // that list, which is what used to close a question on a room mid-answer.
    resetCohort(s, slide?.id ?? null);

    // Landing on a quiz slide that hasn't been revealed yet: arm the time-up
    // auto-reveal. A revisit of an already-revealed slide keeps its reveal and
    // does NOT restart the timer.
    armRevealTimer(io, joinCode, s);
    const persisted = await prisma.session.updateMany({
      where: { id: s.sessionId },
      data: {
        status: s.status,
        currentSlideId: slide?.id ?? null,
        currentSlideStartedAt:
          s.currentSlideStartedAt === null ? null : new Date(s.currentSlideStartedAt),
      },
    });
    if (persisted.count === 0) {
      sessionVanished(joinCode, cb);
      return;
    }

    // The presenter needs the answer key (to highlight correct options once
    // revealed); participants must not get it. Emit the stripped slide to the
    // room and the full one only to the presenter's own socket.
    const common = {
      index: s.currentIndex,
      status: s.status,
      totalSlides: s.slides.length,
      startedAt: s.currentSlideStartedAt,
      // The server's clock AT EMIT, beside the server's `startedAt`. Without
      // it the phone can only subtract `startedAt` from its OWN clock, and a
      // phone 60 s slow was shown 78 seconds left on a 20-second question,
      // paced itself against that, and lost it. Every frame and every ack that
      // carries `startedAt` now carries this too, so the receiver can measure
      // its own offset instead of being graded on a clock nobody controls.
      serverNow: Date.now(),
      // Authoritative countdown length, already scaled. The client must not
      // re-derive this from config or the ring and the auto-reveal disagree.
      timeLimitSec:
        clamped >= 0 && isTimed(s.slides[clamped].type, s.slides[clamped].config)
          ? scaledLimit(s, s.slides[clamped])
          : null,
    };
    // Excepting EVERY host window, not just the primary one. With a single
    // pointer the other tab fell through to the room's broadcast and quietly
    // received the stripped slide — so it could not highlight the correct
    // answer at reveal, while still being the window the host was pressing.
    io.to(joinCode)
      .except(presenterTargets(s))
      .emit("slide:changed", { ...common, currentSlide: slide });
    emitToPresenters(io, s, "slide:changed", {
      ...common,
      currentSlide: currentSlideOf(s, true),
    });

    // Landing back on a slide that was already revealed: `slide:changed` on its
    // own looks identical to opening a fresh question, so the room gets a
    // ticking clock on a closed one and every submit comes back "Time's up".
    // Re-send the stored frame so the UI returns to its revealed state.
    if (slide && s.revealedSlides.has(slide.id)) {
      const stored = s.revealPayloads.get(slide.id);
      // Per socket, like the reveal itself: this is the only frame that tells a
      // phone how it did, so a revisit has to re-stamp each one with its own
      // result rather than re-broadcasting the room's shared half.
      if (stored) await emitRevealFrame(io, joinCode, s, stored);
    }

    // push existing results for the new slide (in case of late reveal)
    if (slide) await emitResults(io, joinCode, slide.id);
    const { stageEntries } = await computeLeaderboard(s);
    sendLeaderboardToPresenter(io, s, stageEntries, true);

    // This callback only ever goes back to the presenter, so it carries answers.
    cb?.({ ok: true, index: s.currentIndex, currentSlide: currentSlideOf(s, true) });
  }

  // Every navigation goes through here. The target is resolved *inside* the
  // chained step rather than at emit time, because a relative move has to read
  // the index left by the move before it — a double-firing clicker that
  // resolved both targets up front would ask to go to the same slide twice.
  // `goto` carries that one step further and resolves it after its own prune,
  // which is still inside this chained step: nothing moves out of the chain,
  // so the serialization guarantee is unchanged.
  function navigate(s: LiveSession, joinCode: string, target: NavTarget, cb?: Function) {
    s.navChain = s.navChain
      .then(() => goto(s, joinCode, target, cb))
      .catch((e) => {
        // One failed step must not poison the chain for the rest of the deck.
        reject(cb, "NAV_FAILED", "Could not change slide");
        console.error("navigation failed", e);
      });
  }

  socket.on("presenter:goto", async (args, cb) => {
    const s = await requirePresenter(args, cb);
    if (!s) return;
    navigate(s, args.joinCode, (cur) => {
      const n = wireIndex(args.index);
      // Nothing index-shaped arrived: hold position. Returning the current
      // index routes into the same-index no-op below rather than inventing a
      // destination out of a malformed frame.
      if (n === null) return cur.currentIndex;
      // -1 means the lobby, and a live room must never be sent back to the
      // waiting screen by an index — a replayed frame or a client bug would
      // snap every phone out of a running session with no confirmation and no
      // clean way back (`prev` was floored for exactly this reason). Once the
      // deck is running, a negative index is not an instruction anyone can
      // have meant, so hold position rather than floor to slide 0: jumping a
      // live room back to the first question is a smaller disaster than the
      // lobby, but it is still not what anybody asked for. A session still in
      // the lobby is already at -1, so nothing legitimate is lost.
      if (n < 0) return cur.currentIndex >= 0 ? cur.currentIndex : -1;
      return n;
    }, cb);
  });

  socket.on("presenter:next", async (args, cb) => {
    const s = await requirePresenter(args, cb);
    if (!s) return;
    // When the slide on screen was deleted out from under the room, the prune
    // has already moved it forward into the vacancy — but silently, with no
    // frame emitted. Advancing from there would step over that slide and show
    // the one after it, so Next lands ON the vacancy: the deleted slide's
    // successor, which is exactly the slide Next meant. (On the last slide of
    // the deck the vacancy is past the end and clamps back onto the
    // predecessor, which is the only place left to be.)
    navigate(s, args.joinCode, (cur, vacancy) => vacancy ?? cur.currentIndex + 1, cb);
  });

  socket.on("presenter:prev", async (args, cb) => {
    const s = await requirePresenter(args, cb);
    if (!s) return;
    // Floors at 0, not -1. Back is the key a host hits to correct a mis-step,
    // and on slide 0 the old floor dropped the entire room to the waiting
    // screen mid-session with no confirmation and no clean way back.
    //
    // Same vacancy rule as Next, from the other side: the deleted slide sat in
    // the vacancy, so the slide before it is `vacancy - 1`. Counting from the
    // re-seated index instead would go one too far back on the last slide of
    // the deck, where the prune falls onto the predecessor — Back would then
    // skip the slide the host was trying to return to.
    navigate(s, args.joinCode, (cur, vacancy) => Math.max(0, (vacancy ?? cur.currentIndex) - 1), cb);
  });

  // ---- Presenter: request the current leaderboard on demand ----
  socket.on("presenter:get-leaderboard", async (args, cb) => {
    const s = await requirePresenter(args, cb);
    if (!s) return;
    // Presenter-verified caller, so this is the stage's board.
    const { stageEntries } = await computeLeaderboard(s);
    cb?.({ ok: true, entries: stageEntries });
  });

  // ---- Presenter: reveal / hide the leaderboard for EVERYONE (presenter +
  // participants) at the same moment — this is what makes it a shared
  // "big screen" moment instead of presenter-only data. ----
  socket.on("presenter:show-leaderboard", async (args, cb) => {
    const s = await requirePresenter(args, cb);
    if (!s) return;
    const { entries, stageEntries } = await computeLeaderboard(s);
    // Remember the exact frame the room is now looking at. A phone that
    // reloads during standings must come back into the same shared moment,
    // and it can only do that if the broadcast left something behind — we
    // keep the frame itself rather than recomputing at join time so the
    // reloader sees the board everyone else is reading, not a newer one.
    s.leaderboardView = { entries };
    s.stageLeaderboardView = stageEntries;
    // Before the broadcast, not after: the stage flipped to the standings the
    // instant the host pressed the key, without waiting for this round trip,
    // so the board it mounts with must already be the one the race resolves
    // to. An exact push here also cancels any coalesced frame still in flight,
    // which would otherwise land mid-race carrying an older board.
    sendLeaderboardToPresenter(io, s, stageEntries, true);
    io.to(args.joinCode).emit("leaderboard:show", { entries });
    cb?.({ ok: true, entries: stageEntries });
  });

  socket.on("presenter:hide-leaderboard", async (args, cb) => {
    const s = await requirePresenter(args, cb);
    if (!s) return;
    s.leaderboardView = null;
    s.stageLeaderboardView = null;
    io.to(args.joinCode).emit("leaderboard:hide", {});
    cb?.({ ok: true });
  });

  socket.on("presenter:end", async (args, cb) => {
    const s = await requirePresenter(args, cb);
    if (!s) return;
    const joinCode = args.joinCode;
    // Idempotent: a second End (a double click, a retried ack) must not rewrite
    // `endedAt` — that overwrites the real end time the session is reported on —
    // nor re-broadcast `session:ended` to a room already on the podium. Ack with
    // the standings so the caller still gets a useful answer.
    if (s.status === "ENDED") {
      const { stageEntries } = await computeLeaderboard(s);
      return cb?.({ ok: true, entries: stageEntries });
    }
    if (s.revealTimer) {
      clearTimeout(s.revealTimer);
      s.revealTimer = null;
    }
    s.status = "ENDED";
    // Starts the eviction clock. The entry lingers briefly so a straggler's
    // ack is still answered out of memory, then the reaper drops it — and a
    // late arrival after that rebuilds it from the row, which is what makes
    // dropping it safe at all. Before recovery existed, `live.delete` was
    // reachable from exactly one place and every session a process had ever
    // run stayed resident for the life of that process.
    s.endedAtMs = Date.now();
    await prisma.session.updateMany({
      where: { id: s.sessionId },
      data: { status: "ENDED", endedAt: new Date() },
    });
    cancelLeaderboardPush(s);
    const { entries, stageEntries, fullEntries } = await computeLeaderboard(s);
    // The broadcast is the room's — participant-scoped, and stamped per socket
    // with that phone's own final standing. The ack is the presenter's, and the
    // podium it draws is the whole room's final board.
    await emitSessionEnded(io, joinCode, entries, fullEntries);
    cb?.({ ok: true, entries: stageEntries });
  });

  // ---- Participant: is this code a room I can walk into? ----
  //
  // The join used to be the first thing that could say "Invalid code", and it
  // is gated on the nickname — so a wrong digit was discovered two screens
  // later, on a dead-end screen whose one button landed on an EMPTY field
  // (UX-PLAN 3.1). This answers the question the moment the code is typed,
  // with nothing more than the title to put over the nickname field.
  //
  // It is a read, so it seats nobody and writes nothing, and it reveals
  // nothing `participant:join` would not: the same three refusals, the same
  // budget. A BAD_CODE here is charged exactly as a BAD_CODE there (it is the
  // one shape that looks like somebody walking the code space), so a phone
  // cannot use this to enumerate codes more cheaply than it could already.
  // `participant:join` keeps every check it has — defence in depth, and the
  // QR path never comes through here at all.
  socket.on("session:peek", async ({ joinCode, participantId }, cb) => {
    if (badParticipantId(participantId)) return reject(cb, "BAD_PARTICIPANT", "Invalid participant");
    const ip = clientIp(socket);
    if (tooManyJoinFailures(ip, participantId)) {
      return reject(cb, "RATE_LIMITED", "Too many attempts. Try again in a minute.");
    }
    const s = await loadLive(joinCode);
    if (!s) {
      recordJoinFailure(ip, participantId, true);
      return reject(cb, "BAD_CODE", "Invalid code");
    }
    if (s.status === "ENDED") {
      recordJoinFailure(ip, participantId, false);
      return reject(cb, "SESSION_ENDED", "Session has ended");
    }
    // The title is a courtesy, not a contract: the room is real without it.
    let title: string | undefined;
    try {
      const row = await prisma.presentation.findUnique({
        where: { id: s.presentationId },
        select: { title: true },
      });
      title = row?.title ?? undefined;
    } catch {
      /* the peek still answers */
    }
    cb?.({ ok: true, status: s.status, title });
  });

  // ---- Participant: join by code ----
  socket.on("participant:join", async ({ joinCode, participantId, seatSecret, name, avatar }, cb) => {
    // Before the throttle, whose keys are built from it.
    if (badParticipantId(participantId)) return reject(cb, "BAD_PARTICIPANT", "Invalid participant");
    const ip = clientIp(socket);
    // Checked before the code is resolved, deliberately: a throttled caller
    // must not be able to read a wrong code off the shape of the refusal.
    if (tooManyJoinFailures(ip, participantId)) {
      return reject(cb, "RATE_LIMITED", "Too many attempts. Try again in a minute.");
    }
    // Resolved through the database, so a phone coming back to a room whose
    // server restarted lands in the room it is actually looking for instead of
    // being told its code is invalid.
    const s = await loadLive(joinCode);
    if (!s) {
      // No such code has ever been issued. This is the only failure shape that
      // looks like somebody walking the code space, so it is the only one that
      // spends the shared per-IP budget.
      recordJoinFailure(ip, participantId, true);
      return reject(cb, "BAD_CODE", "Invalid code");
    }
    if (s.status === "ENDED") {
      // A real room at the wrong moment. Charged to this device only — a whole
      // venue re-joining a finished session must not lock out the building.
      recordJoinFailure(ip, participantId, false);
      // A refusal that still answers the question. The client turns this
      // particular code into the PODIUM rather than an error, so it is the
      // reload path for every player sitting on their result — and it used to
      // carry nothing, which meant a phone that reloaded on its own podium came
      // back to the words "That's a wrap" over an empty screen: no board, no
      // rank, no score. Measured before this: a player who finished 4th on 955
      // read `#2 Bot1 / Bot0 WINNER / #3 Bot2 / YOU FINISHED #4 955 points`,
      // reloaded, and read `That's a wrap`.
      //
      // Same two fields `session:ended` stamps per socket, and the same public
      // board — deliberately `entries`, never `fullEntries`: every row carries a
      // `participantId`, which is the whole of what this very handler needs to
      // take that seat, so a refusal is the last place to widen it.
      //
      // The PUBLIC board goes to anyone with the code; THIS seat's rank and
      // score only to the phone holding the seat's secret. Otherwise the
      // refusal is a results oracle: any id, read off an export or an old
      // board, returns that player's placing.
      if (typeof participantId === "string" && participantId) {
        try {
          const [{ entries, fullEntries }, mine] = await Promise.all([
            computeLeaderboard(s),
            holdsSeat(s.sessionId, participantId, seatSecret),
          ]);
          const i = mine ? fullEntries.findIndex((e) => e.participantId === participantId) : -1;
          return cb?.({
            error: "Session has ended",
            code: "SESSION_ENDED",
            entries,
            // Absent from the board means they submitted nothing all session:
            // null, not an invented last place (matching `emitSessionEnded`).
            myRank: i >= 0 ? i + 1 : null,
            myScore: i >= 0 ? fullEntries[i].score : null,
            // Same shape as `session:ended`, same reason (FLOW §6.4): a reload
            // on the podium must come back to the same screen, "of 34" included.
            totalPlayers: fullEntries.length,
          });
        } catch {
          // The board is a courtesy on a refusal path. If it cannot be built,
          // the refusal itself still has to land.
        }
      }
      return reject(cb, "SESSION_ENDED", "Session has ended");
    }
    if (typeof participantId !== "string" || !participantId) {
      return reject(cb, "BAD_PARTICIPANT", "Invalid participant");
    }
    // Before anything binds this socket to the id: see "Seat secrets" above.
    let seat: SeatCheck;
    try {
      seat = await claimOrVerifySeat(s.sessionId, participantId, seatSecret);
    } catch (e) {
      console.error("could not verify seat", e);
      return reject(cb, "SEAT_UNVERIFIED", "Couldn't confirm your seat. Try again.");
    }
    if (!seat.ok) {
      // Deliberately NOT charged to the join throttle. Its device key is
      // `ip|participantId` — and here the participantId is the one the CALLER
      // claimed, i.e. the victim's. Behind a venue's shared NAT, ten wrong
      // secrets would have rate-limited the real owner out of their own seat:
      // the protection against impersonation turned into a way to kick a
      // named player. Nothing is lost by it, since 256 random bits are not
      // guessable at any rate the throttle could matter to.
      return reject(cb, "SEAT_TAKEN", "That seat belongs to another device.");
    }
    // They are in. Whatever they fumbled on the way here was a fumble, so give
    // the budget back — to them and to the IP they share with the room.
    forgiveJoinFailures(ip, participantId);
    s.lastActivityAt = Date.now();

    // The client's socket is an app-wide singleton, so a phone that moves
    // from one room to another arrives here still seated in the first: still
    // counted on that wall, still sent its slides and reveals — which the
    // phone applied to the new room's screen. Leave it first.
    if (socket.data.role === "participant" && socket.data.joinCode && socket.data.joinCode !== joinCode) {
      releaseParticipant();
    }

    socket.join(joinCode);
    socket.data.joinCode = joinCode;
    socket.data.role = "participant";
    socket.data.participantId = participantId;
    // How long this identity was out of contact, measured BEFORE the socket
    // pointer is moved — afterwards there is nothing left to compare against.
    // This is the only thing that can turn a `clientTapAt` into points; see
    // the OUTAGE CREDIT block above for the trust argument.
    const outage = measureOutage(io, s, participantId, socket.id);
    if (outage > 0) {
      s.outageCredits.set(participantId, {
        creditMs: Math.min(outage, OUTAGE_CREDIT_CAP_MS),
        expiresAt: Date.now() + OUTAGE_CREDIT_TTL_MS,
      });
    }
    // This socket is now the one that owns this identity. Disconnect consults
    // this to tell a stale tab's teardown apart from the real player leaving.
    s.participantSockets.set(participantId, socket.id);
    // preserve existing name/avatar if this participantId already joined
    // (reconnect). The ROSTER is consulted, not just the connected set: a
    // player whose socket dropped is absent from `participants` but has lost
    // nothing, so a silent reconnect that sends no name must restore theirs
    // rather than christen them "Anonymous".
    const existing = s.participants.get(participantId) ?? s.roster.get(participantId);
    // Cap before filtering, matching `qa:ask`'s treatment of authorName. The
    // lobby chip and the leaderboard row have no defence against a 120-char
    // nickname, and the filter only masks content — it never truncates.
    const rawName = String(name ?? "").trim().slice(0, MAX_NICKNAME_LEN);
    const identity = {
      name: filterNickname(rawName || existing?.name || "Anonymous"),
      avatar: typeof avatar === "number" ? avatar : existing?.avatar ?? 0,
    };
    s.participants.set(participantId, identity);
    s.roster.set(participantId, identity);

    // Write the person down. Until this existed a name lived only in process
    // memory, which is why a dropped socket cost a player their identity on the
    // podium and why a restart could never rebuild a room: the scores survived
    // with nothing anywhere to say whose they were. Awaited so the roster and
    // the row cannot disagree about who is here.
    try {
      await prisma.participant.upsert({
        where: { sessionId_participantId: { sessionId: s.sessionId, participantId } },
        create: {
          sessionId: s.sessionId,
          participantId,
          name: identity.name,
          avatar: identity.avatar,
        },
        update: { name: identity.name, avatar: identity.avatar, lastSeenAt: new Date() },
      });
    } catch (e) {
      // A roster write failing must not keep a player out of the room — they
      // can still answer, and they are already in the in-memory roster above.
      console.error("could not persist participant", e);
    }

    pushParticipants(io, joinCode, s);

    const current = currentSlideOf(s);
    const idx = s.currentIndex;

    // Audience pacing: this is the moment this player reached this slide, and
    // therefore the moment their clock on it starts.
    if (current) markArrival(s, participantId, current.id);

    // Arriving mid-question joins the quorum: the early reveal must now wait
    // for this phone too, or one answer from somebody already here would close
    // a question this player has only just been handed.
    if (current) joinCohort(s, participantId, current.id);

    // A re-join (reconnect, reload, resumed tab) must land the phone in the
    // state the room is actually in, not at the top of a fresh question. Two
    // concrete failures come from the ack omitting this: a phone that missed
    // the reveal renders a live countdown on a closed question, and — because
    // it also forgot it had answered — one stray tap re-submits, overwriting an
    // already-scored answer with 0. `revealed`/`reveal` fix the first;
    // `answered`/`myAnswer` fix the second and let the UI show their pick.
    const revealed = !!current && s.revealedSlides.has(current.id);
    let answered = false;
    let myAnswer: any = null;
    // What their answer SCORED. `feedback` is component state on the phone, so
    // a reload after a reveal came back without "Correct", without "+973" and
    // without a rank — the player told strictly less than they had a moment
    // earlier, for no reason other than that the only copy of it lived in the
    // tab that went away. The graded row has been here the whole time.
    let myResult: MyResult | null = null;
    if (current) {
      const mine = await prisma.response.findUnique({
        where: {
          sessionId_slideId_participantId: {
            sessionId: s.sessionId,
            slideId: current.id,
            participantId,
          },
        },
        select: { value: true, correct: true, points: true },
      });
      if (mine) {
        answered = true;
        myAnswer = safeParse(mine.value);
        // The same test `participant:submit` uses to decide `isQuiz`, so the
        // two acks cannot disagree about which slides carry a result at all —
        // including the embargo. Restoring a result the phone was never given
        // in the first place would make a reconnect the answer-key oracle the
        // submit ack has just stopped being: answer, drop the socket, re-join,
        // read `correct`. A phone can only be handed back what it already had.
        if (idx >= 0 && isTimed(s.slides[idx].type, s.slides[idx].config) && !embargoed(s, current.id)) {
          const { fullEntries } = await computeLeaderboard(s);
          myResult = {
            isQuiz: true,
            correct: mine.correct,
            points: mine.points,
            totalScore: fullEntries.find((e) => e.participantId === participantId)?.score ?? 0,
            // A rank is a claim about the ROOM, and the phones embargo it until
            // `leaderboardView` says the room has seen the standings — showing
            // it earlier spends the stage's bar race on a result every phone is
            // already holding. Sending it here is what keeps that decision the
            // client's: the server restores the whole result, the client
            // chooses the moment. Scored over everyone, like the submit ack's.
            rank: fullEntries.findIndex((e) => e.participantId === participantId) + 1,
          };
        }
      }
    }

    cb?.({
      ok: true,
      status: s.status,
      index: idx,
      currentSlide: current,
      totalSlides: s.slides.length,
      // The name the ROOM will see, after the cap and the filter above. The
      // phone used to say "You're in, Dave" while the wall said "Anonymous",
      // with nothing on the phone to explain it — the only copy of the stored
      // name was in the roster. Echoed so the phone can say what was understood
      // (PULSE T6: the normalisation is shown).
      name: identity.name,
      startedAt: s.currentSlideStartedAt,
      // Paired with `startedAt` everywhere it appears — see `slide:changed`.
      // On this ack in particular it is what lets a phone that has just
      // reconnected re-measure its offset before it renders a countdown.
      serverNow: Date.now(),
      // Authoritative, already scaled — same rule as `slide:changed`, so a
      // rejoining phone's ring agrees with the auto-reveal it is racing.
      timeLimitSec:
        idx >= 0 && isTimed(s.slides[idx].type, s.slides[idx].config)
          ? scaledLimit(s, s.slides[idx])
          : null,
      pacing: s.pacing,
      // This phone's own entry in the opaque key space the roster now speaks.
      // Additive and not yet required by anything: `participant:count` already
      // identifies everyone by `pkey`, and the public leaderboard rows still
      // carry `participantId` purely because the client finds ITSELF in them
      // by id. With this the client can switch that comparison to `pkey` and
      // the last ten bearer tokens come off the wire. See the audit note.
      myPkey: publicKeyFor(s, participantId),
      revealed,
      // Only ever populated once the slide is revealed, so this cannot become a
      // second path by which the answer key reaches a participant early.
      reveal: revealed ? s.revealPayloads.get(current!.id) ?? null : null,
      answered,
      myAnswer,
      // The graded result of `myAnswer`, in exactly the spelling
      // `participant:submit` acks with — `{ isQuiz, correct, points,
      // totalScore, rank }` — so a reconnecting phone restores its feedback
      // through the same path a fresh submission takes, rather than needing a
      // second shape for the same fact. `null` when this phone has not
      // answered the slide in front of it, or when that slide is not scored.
      myResult,
      // `leaderboard:show` is a one-shot broadcast, so a phone that reloads
      // while the projector is on the standings came back rendering the slide
      // — out of a moment the rest of the room is still sharing. Same
      // `{ entries }` shape as the broadcast, so the client unwraps one thing;
      // null whenever the board is not up, which is the common case.
      leaderboardView: s.leaderboardView,
    });
  });

  // ---- Participant: self-navigate (audience-paced decks only) ----
  socket.on("participant:goto", async ({ joinCode, participantId, index }, cb) => {
    const s = await loadLive(joinCode);
    if (!s) return reject(cb, "SESSION_GONE", "Session not found");
    // The same guard `presenter:goto/next/prev` and `participant:submit` all
    // carry, and the only handler that was missed. Nothing can be scored once
    // the deck is ENDED, so the player was simply being served slides from a
    // finished deck: a live-looking question that silently answers nothing.
    if (s.status === "ENDED") return reject(cb, "SESSION_ENDED", "Session has ended");
    if (s.pacing !== "AUDIENCE") return reject(cb, "HOST_PACED", "The host is driving this deck");
    // Who you are AND which room you are in — the same pairing `qa:list`
    // carries. Without the room half a socket joined to one session could
    // drive, and score into, another: the row lands in a room whose roster has
    // never heard of them, which is a second way to manufacture an unnamed
    // entry in someone else's standings.
    if (
      socket.data.role !== "participant" ||
      socket.data.participantId !== participantId ||
      socket.data.joinCode !== joinCode
    ) {
      return reject(cb, "NOT_JOINED", "Join the session first");
    }
    s.lastActivityAt = Date.now();
    // Self-pacing is the one navigation the host never performs, so without
    // this the snapshot of an audience-paced deck is never reconciled at all
    // and a deleted slide stays reachable for the whole session. Runs on the
    // presenter's nav chain rather than inline: pruning mutates `s.slides`,
    // and doing that in the middle of a `goto` that has already resolved its
    // target moves the ground under it.
    s.navChain = s.navChain
      .then(async () => {
        await reconcileDeletedSlides(s);
        if (s.slides.length === 0) return reject(cb, "SLIDE_GONE", "Slide not found");
        const clamped = Math.max(0, Math.min(wireIndex(index) ?? 0, s.slides.length - 1));
        const slideObj = s.slides[clamped];
        const slide = publicSlide(slideObj);
        // THIS player has now reached THIS slide, and that is the instant their
        // answer will be timed from. First arrival wins, so stepping back and
        // forward cannot reopen the window.
        markArrival(s, participantId, slideObj.id);
        // Only this socket is told — everyone else stays where they are, which
        // is the whole point of audience pacing.
        cb?.({
          ok: true,
          index: clamped,
          currentSlide: slide,
          totalSlides: s.slides.length,
          // A self-paced slide has no SHARED clock, but it does have this
          // player's own, which is what their score is now measured against.
          // Reported in wall-clock ms, same units and same name as every other
          // `startedAt` on the wire, so a countdown can be rendered against it
          // rather than the player being graded on a clock they cannot see.
          startedAt: arrivalWallClock(s, participantId, slideObj.id),
          // Paired with `startedAt` everywhere it appears — see
          // `slide:changed`. A self-paced player has no shared clock at all,
          // so this is the only thing that anchors their ring to the server's.
          serverNow: Date.now(),
          timeLimitSec: isTimed(slideObj.type, slideObj.config)
            ? scaledLimit(s, slideObj)
            : null,
        });
      })
      .catch((e) => {
        reject(cb, "NAV_FAILED", "Could not change slide");
        console.error("participant navigation failed", e);
      });
  });

  // ---- Participant: submit a response ----
  socket.on("participant:submit", async ({ joinCode, slideId, participantId, value, clientTapAt }, cb) => {
    // Read the clocks at the top, before any await. Everything below measures
    // against the instant this frame ARRIVED, not the instant the database
    // finished with it.
    const arrivedMono = monoNow();
    const arrivedWall = Date.now();
    const s = await loadLive(joinCode);
    if (!s) return reject(cb, "SESSION_GONE", "Session not found");
    if (s.status === "ENDED") return reject(cb, "SESSION_ENDED", "Session has ended");
    // Bind the answer to the connection that joined: a socket can only submit
    // as the participantId it joined with, so one student can't overwrite
    // another's answer or inject leaderboard scores under an arbitrary id.
    // The join code is checked too, so a socket seated in one room cannot score
    // into another — the row would land under a participantId that room's
    // roster has never heard of, which is exactly how an unnamed entry appears
    // in somebody else's standings.
    if (
      socket.data.role !== "participant" ||
      socket.data.participantId !== participantId ||
      socket.data.joinCode !== joinCode
    ) {
      return reject(cb, "NOT_JOINED", "Join the session before submitting");
    }
    const slide = s.slides.find((x) => x.id === slideId);
    if (!slide) return reject(cb, "SLIDE_GONE", "Slide not found");
    s.lastActivityAt = Date.now();

    // Content slides (headings, images) take no responses at all.
    if (!isInteractive(slide.type)) return reject(cb, "NOT_ANSWERABLE", "This slide takes no answers");

    // Reject malformed values before they reach the database — a client can
    // send anything, and a bad value would otherwise corrupt the aggregate.
    if (!validateValue(slide.type, slide.config, value)) {
      return reject(cb, "BAD_ANSWER", "Invalid answer");
    }

    // Free text reaches the projected screen with no human in the loop, so it
    // is filtered here rather than at render time — a client that skips the
    // UI entirely still cannot put slurs on a wall.
    value = sanitiseFreeText(value, s.filterMode);
    if (value === REJECTED) {
      return reject(cb, "FILTERED", "Let's keep it friendly — try rephrasing.");
    }
    const encoded = JSON.stringify(value);

    // ---- A re-send of an answer already stored is not a new answer ----
    //
    // The offline queue settles only on an ack BODY, which is correct: the
    // server may have the row while the phone has nothing. So when a link drops
    // between the write and the ack, the identical answer is re-sent on
    // reconnect — and re-grading it from scratch charged the player for the
    // outage. Measured: 972 points at submit, 933 after a 6.5 s drop, with the
    // player having changed nothing. The mechanism built to protect people on
    // weak connections was the thing billing them for it.
    //
    // The test is the stored bytes, not a lock: changing your answer is a
    // supported feature and a DIFFERENT value falls straight through to the
    // re-grade below, timed from now, as it must be — otherwise an early answer
    // would buy an unlimited window to swap it later.
    //
    // Deliberately ahead of the revealed/TOO_LATE guard. A re-send that arrives
    // after the question closed writes nothing and changes nothing; answering
    // it with "Time's up" would tell a player who answered on time that they
    // did not, and hand the ack queue an error for a success.
    const prior = await prisma.response.findUnique({
      where: {
        sessionId_slideId_participantId: { sessionId: s.sessionId, slideId, participantId },
      },
      select: { value: true, correct: true, points: true },
    });
    if (prior && prior.value === encoded) {
      if (!isTimed(slide.type, slide.config)) return cb?.({ ok: true, isQuiz: false });
      // Same embargo as a fresh submission, or it is a trivial way around it:
      // send a value, get nothing, send the identical value again and read the
      // grade off the idempotent settle. `duplicate` stays — it is how the
      // retry queue tells an already-stored answer from a newly scored one,
      // and it says nothing about whether the answer was right.
      if (embargoed(s, slideId)) return cb?.({ ok: true, isQuiz: true, duplicate: true });
      const { fullEntries } = await computeLeaderboard(s);
      const rank = fullEntries.findIndex((e) => e.participantId === participantId) + 1;
      const totalScore = fullEntries.find((e) => e.participantId === participantId)?.score ?? 0;
      return cb?.({
        ok: true,
        isQuiz: true,
        correct: prior.correct,
        points: prior.points,
        totalScore,
        rank,
        // Says "we already had this" rather than "we scored this again", so a
        // client can tell an idempotent settle from a fresh result.
        duplicate: true,
      });
    }

    // ---- A self-paced answer is final once its result has been handed over ----
    //
    // Changing your answer stays a supported feature everywhere the player has
    // not yet been told whether they were right. Under AUDIENCE pacing they
    // HAVE been told — there is no shared reveal to wait for, so the result
    // card goes out with the first ack (see `embargoed`) — and a different
    // value after that is not a change of mind, it is a second guess against a
    // key already on their screen. Left open, it is the N3 oracle surviving in
    // the one room the embargo deliberately does not cover: probe, read
    // `correct`, probe again, at a cost of one round trip each. An identical
    // re-send is untouched above, so the offline retry queue still settles.
    if (prior && s.pacing === "AUDIENCE" && isTimed(slide.type, slide.config)) {
      return reject(cb, "TOO_LATE", "You've already answered this one");
    }

    // ---- Once revealed the window has closed, but not to the millisecond ----
    //
    // The reveal fires at exactly `startedAt + limit`, and this check used to
    // reject anything arriving after it. An answer tapped at 19.9s on a 20s
    // question and delivered at 20.1s was therefore thrown away — the player
    // did everything right and the network spent their last tenth of a second.
    // On venue Wi-Fi that is not an edge case, and it is indistinguishable, to
    // the person it happens to, from the app losing their answer.
    //
    // So a frame that lands within `NETWORK_GRACE_MS` of the close is still
    // accepted. It buys nothing: grading runs unchanged below, and because
    // `speedPoints` clamps elapsed to the full window, an answer admitted here
    // scores the floor — exactly what the slowest honest answer scores. The
    // grace recovers the ANSWER, never the speed bonus.
    //
    // Bounded by the server's own measurement, never a client's claim. The only
    // input is when this frame arrived, which the client cannot forge: holding
    // an answer back to think about it past the buzzer still misses the window,
    // because the window is measured from the close rather than from anything
    // the phone says about itself.
    //
    // A reveal with no recorded instant gets no grace at all. That is the
    // rehydrate case — a question closed before this process existed — and
    // treating "I do not know when it closed" as "it closed long ago" is the
    // direction that cannot reopen a settled question.
    //
    // One honest side effect: the room has already SEEN the reveal, and the
    // aggregate the stage holds is the frozen one. An answer admitted here
    // updates the stored responses and the next `results:updated`, so a bar can
    // still move slightly while the reveal animation is playing. A quietly
    // discarded answer seemed the worse of the two.
    if (s.revealedSlides.has(slideId)) {
      if (!withinNetworkGrace(arrivedMono, s.revealedAtMono.get(slideId))) {
        return reject(cb, "TOO_LATE", "Time's up");
      }
    }

    // ---- Pay back whatever a delivery gap cost, and nothing more ----
    //
    // See the OUTAGE CREDIT block above for the full trust argument. In short:
    // the refund is bounded by what the SERVER measured (how long this phone
    // was out of contact), the client's own claim can only shrink it, and with
    // no measured gap there is no refund at all — so a healthy client claiming
    // it tapped at the starting gun is graded exactly as it is today.
    const startedMono = scoringStartedAt(s, participantId, slideId);
    const startedWall =
      s.pacing === "AUDIENCE"
        ? arrivalWallClock(s, participantId, slideId)
        : s.currentSlideStartedAt;
    let creditMs = 0;
    if (startedMono !== null && startedWall !== null) {
      const budget = consumeOutageCredit(s, participantId);
      if (budget > 0 && typeof clientTapAt === "number" && Number.isFinite(clientTapAt)) {
        // Elapsed as the server sees it, and elapsed as the player claims it.
        // Clamping the claim into [0, elapsed] is the floor the brief asks
        // for: a tap "before" the question opened is read as the instant it
        // opened, and one "after" this frame arrived is read as now.
        const elapsedMs = Math.max(0, arrivedMono - startedMono);
        const tapWall = Math.min(Math.max(clientTapAt, startedWall), arrivedWall);
        const claimedMs = Math.min(tapWall - startedWall, elapsedMs);
        creditMs = Math.max(0, Math.min(elapsedMs - claimedMs, budget));
      }
    }

    const graded = gradeSubmission(
      slide.type,
      // Always the session's authoritative window, not the raw config. It is
      // already clamped and already stretched by `timeScale` — grading against
      // the unstretched value quietly costs every player points for answering
      // at the same relative moment, turning an accessibility option into a
      // scoring penalty.
      { ...slide.config, timeLimitSec: scaledLimit(s, slide) },
      value,
      {
        // The monotonic clock on both sides. Wall-clock grading against a
        // monotonic deadline meant a clock step rewrote scores while the
        // question's own expiry did not move: a step back handed out full
        // marks, a step forward floored them, both silently.
        //
        // WHICH start, though, is a per-player question in audience pacing:
        // the host never navigates there, so grading off the room's shared
        // start measured every answer from whenever the host last happened to
        // touch the deck — or, if they never did, from nothing at all, which
        // disabled speed scoring without saying so.
        slideStartedAt: startedMono,
        // Arrival, less whatever the measured outage justifies refunding. The
        // clock is read once at the top of the handler, so the database round
        // trips above cannot bill the player for the server's own latency.
        now: arrivedMono - creditMs,
      }
    );
    if (creditMs > 0) {
      console.log(
        `[outage-credit] ${joinCode} ${participantId} slide=${slideId} refunded ${creditMs}ms`
      );
    }

    // The question AS ASKED, stored alongside the answer. `slide` here is the
    // session's frozen snapshot — the exact text and config the room was shown
    // — and the deck row it came from is editable forever after. Without this
    // the CSV renders a stored option INDEX through whatever options the slide
    // carries today, so retitling a question or reordering its options
    // silently relabels last term's answers. Written on update as well as
    // create: the snapshot does not change within a session, so both branches
    // write the same bytes, and a row first saved before this column existed
    // gets it filled in the moment the player changes their answer.
    const asAsked = {
      slideQuestion: slide.question,
      slideType: slide.type,
      slideConfig: JSON.stringify(slide.config),
    };
    try {
      await prisma.response.upsert({
        where: {
          sessionId_slideId_participantId: { sessionId: s.sessionId, slideId, participantId },
        },
        create: {
          sessionId: s.sessionId,
          slideId,
          participantId,
          value: encoded,
          correct: graded.correct,
          points: graded.points,
          ...asAsked,
        },
        update: {
          value: encoded,
          correct: graded.correct,
          points: graded.points,
          ...asAsked,
        },
      });
    } catch (e) {
      return reject(cb, "SAVE_FAILED", "Could not save response");
    }

    await emitResults(io, joinCode, slideId);
    pushAnsweredCount(io, joinCode, s, slideId);

    if (isTimed(slide.type, slide.config)) {
      // Single leaderboard query, reused for both this participant's ack and
      // the presenter's live view — was previously computed twice per submit.
      const { stageEntries, fullEntries } = await computeLeaderboard(s);
      const rank = fullEntries.findIndex((e) => e.participantId === participantId) + 1;
      const totalScore = fullEntries.find((e) => e.participantId === participantId)?.score ?? 0;
      // The one push that is NOT exact-on-arrival: nothing is on screen yet,
      // and in a full room this fires once per answer. Coalesced (see
      // sendLeaderboardToPresenter); the reveal that follows is immediate.
      sendLeaderboardToPresenter(io, s, stageEntries);
      // Under presenter pacing a result the room has not been shown yet is the
      // answer key, one bit at a time. The player is told their answer landed
      // and nothing else; the grade arrives in the `slide:reveal` beat, which
      // now carries a per-socket `myResult` for exactly this. See `embargoed`.
      if (embargoed(s, slideId)) {
        cb?.({ ok: true, isQuiz: true });
      } else {
        cb?.({ ok: true, isQuiz: true, correct: graded.correct, points: graded.points, totalScore, rank });
      }

      // ---- Everyone has answered: close the question early ----
      //
      // AUDIENCE pacing never does this, for the reason `armRevealTimer`
      // already spells out at length: a reveal is a SHARED moment and a
      // self-paced deck has none, because at any instant different people are
      // on different slides. That guard was on the timer path only, and this
      // path had none at all — so in a self-paced room, where `participants`
      // is routinely a set of ONE, the first player through the deck revealed
      // every slide as they finished it, `persistRevealed` made that permanent,
      // and the next person to open the link was handed the answer key in
      // their join ack and TOO_LATE on every question.
      if (s.pacing === "AUDIENCE") return;

      // "Everyone" is the slide's COHORT, not the connected set. The numerator
      // was already measured over people still in the room — a player who
      // answered and then dropped their socket must not count — but the
      // denominator was `participants.size`, which shrinks the moment a phone
      // locks. One player answering while they were momentarily the only live
      // socket therefore closed the question on everybody still typing: the
      // same failure the comment above described, arriving from the other
      // side. The cohort only grows while a slide is up, so leaving can no
      // longer shorten the list of people the room is waiting for. Someone who
      // walks out for good simply means the countdown closes the question
      // instead of the quorum, which is the safe direction to fail in.
      const cohort = s.slideCohort.slideId === slideId ? s.slideCohort.ids : null;
      if (!cohort || cohort.size === 0) return;
      const rows = await prisma.response.findMany({
        where: { sessionId: s.sessionId, slideId },
        select: { participantId: true },
      });
      const answered = new Set(rows.map((r) => r.participantId));
      const everyone = [...cohort].every((pid) => answered.has(pid));
      if (everyone && !s.revealedSlides.has(slideId)) {
        if (s.revealTimer) {
          clearTimeout(s.revealTimer);
          s.revealTimer = null;
        }
        await revealSlide(io, joinCode, slide);
      }
    } else {
      cb?.({ ok: true, isQuiz: false });
    }
  });

  // ---- Disconnect ----
  // ---- Participant: walk out of the room ----
  //
  // "Leave" on the phone used to rely on the socket's own disconnect to take
  // the player off the wall, but that socket is shared by the whole app and
  // never disconnects on a route change. Same teardown a disconnect does.
  socket.on("participant:leave", (_args: unknown, cb?: Function) => {
    if (socket.data.role === "participant") releaseParticipant();
    cb?.({ ok: true });
  });

  /**
   * Take this socket out of the room it is seated in, as a participant: off
   * the wall (if it still owns the identity), out of the broadcast room, and
   * no longer bound to the seat, so nothing downstream will act for it.
   * Shared by a disconnect, an explicit leave, and a join to another room.
   */
  function releaseParticipant() {
    const joinCode = socket.data.joinCode as string | undefined;
    if (!joinCode) return;
    const s = live.get(joinCode);
    if (s) evictIfOwner(s, joinCode);
    socket.leave(joinCode);
    delete socket.data.joinCode;
    delete socket.data.role;
    delete socket.data.participantId;
  }

  function evictIfOwner(s: LiveSession, joinCode: string) {
    // Evict only if this socket is still the one that owns the identity. A
    // player can have more than one socket alive — a second tab, a reconnect
    // whose old transport has not timed out yet — and the loser's teardown
    // used to delete the live player: they vanished from the lobby and, with
    // no entry left in `participants`, reached the podium as "Anonymous".
    //
    // Only the CONNECTED set is touched. `roster` deliberately keeps them: a
    // closed socket is a phone that locked, not a person who was never here,
    // and the score is already durable. Dropping the name alongside the socket
    // is what put a winner on the podium as "Anonymous", in front of the room,
    // with somebody else's avatar.
    const pid = socket.data.participantId;
    if (socket.data.role === "participant" && pid && s.participantSockets.get(pid) === socket.id) {
      s.participantSockets.delete(pid);
      s.participants.delete(pid);
      // Remember when this phone last spoke, so a reconnect can be told apart
      // from a long silence and the gap between them measured honestly.
      s.lastHeardFrom.set(pid, (socket.data.lastPacketAt as number | undefined) ?? Date.now());
      pushParticipants(io, joinCode, s);
    }
  }

  socket.on("disconnect", () => {
    const joinCode = socket.data.joinCode;
    const s = joinCode ? live.get(joinCode) : undefined;
    if (!s) return;
    evictIfOwner(s, joinCode);
    // A host window closing gives up its share of the presenter view. If it was
    // the primary, hand that title to whichever window is still open rather
    // than leaving the room with a pointer at a dead socket.
    if (s.presenterSockets.delete(socket.id)) {
      if (s.presenterSocketId === socket.id) {
        s.presenterSocketId = presenterTargets(s)[0] ?? null;
      }
      if (s.presenterSockets.size > 0) announcePresenters(io, s);
    }
    // If the session is ending (presenter gone), tear down any pending reveal.
    if (s.status === "ENDED" && s.revealTimer) {
      clearTimeout(s.revealTimer);
      s.revealTimer = null;
    }
  });
}

/** The countdown this session actually runs for a slide. */
function scaledLimit(s: LiveSession, slide: LiveSession["slides"][number]): number {
  return Math.round(timeLimitSec(slide.type, slide.config) * s.timeScale);
}

/** Sentinel for a submission the filter rejected outright. */
const REJECTED = Symbol("rejected") as unknown as string;

/**
 * Apply the content filter to whatever free text a value carries. Numbers,
 * indices and coordinates pass through untouched — there is nothing to filter
 * and nothing to break.
 */
function sanitiseFreeText(value: unknown, mode: FilterMode): any {
  if (mode === "off") return value;
  if (typeof value === "string") {
    const r = filterText(value, mode);
    return r.rejected ? REJECTED : r.text;
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    const out: string[] = [];
    for (const v of value) {
      const r = filterText(v, mode);
      if (r.rejected) return REJECTED;
      out.push(r.text);
    }
    return out;
  }
  return value;
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
