import type { Server, Socket } from "socket.io";
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
  participants: Map<string, { name: string; avatar: number }>;
  presenterSocketId: string | null;
  // wall-clock ms when the current slide became active — used to time quiz answers
  currentSlideStartedAt: number | null;
  // pending auto-reveal timer for the current quiz slide (fires on time-up)
  revealTimer: ReturnType<typeof setTimeout> | null;
  // slideIds already revealed — revealing is one-shot per slide
  revealedSlides: Set<string>;
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
  leaderboardView: { entries: LeaderboardEntryRow[] } | null;
  // Serialises navigation. `goto` awaits a DB write halfway through, so two
  // overlapping calls interleave there and the later emit wins carrying a
  // stale slide with a fresh index — the room and the stage then disagree
  // until the next navigation. Chaining every nav onto this promise means a
  // burst of Next presses is applied strictly in order.
  navChain: Promise<unknown>;
}

const live = new Map<string, LiveSession>();

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

function recordJoinFailure(ip: string, participantId: unknown) {
  const now = Date.now();
  // Device keys are per-client, so the map would otherwise grow without bound
  // over a long-running server. Expired windows carry no information — drop them.
  if (joinFailures.size > 1000) {
    for (const [key, rec] of joinFailures) if (now >= rec.resetAt) joinFailures.delete(key);
  }
  for (const key of joinKeys(ip, participantId)) {
    const rec = joinFailures.get(key);
    if (!rec || now >= rec.resetAt) {
      joinFailures.set(key, { count: 1, resetAt: now + JOIN_WINDOW_MS });
    } else {
      rec.count++;
    }
  }
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

// The one spelling of "who is in the room". The `participant:count` broadcast,
// its disconnect twin and the presenter's resume ack all describe the same
// thing, so they ship the same field names and the same element shape and the
// client can reduce all three through a single code path.
function participantsPayload(s: LiveSession) {
  return {
    count: s.participants.size,
    participants: [...s.participants].map(([participantId, p]) => ({
      participantId,
      name: p.name,
      avatar: p.avatar,
    })),
  };
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
  if (s.presenterSocketId) {
    io.to(s.presenterSocketId).emit("results:updated", { slideId, aggregate });
  }
}

// Score is the sum of `points` across all of a participant's responses in this
// session. Because responses are upserted (one row per participant+slide),
// this naturally handles a participant changing their answer — no risk of
// double-counting points from a resubmission.
async function computeLeaderboard(s: LiveSession, limit = 10) {
  const rows = await prisma.response.groupBy({
    by: ["participantId"],
    where: { sessionId: s.sessionId },
    _sum: { points: true },
  });
  const entries = rows
    .map((r) => ({
      participantId: r.participantId,
      name: s.participants.get(r.participantId)?.name ?? "Anonymous",
      score: r._sum.points ?? 0,
      avatar: s.participants.get(r.participantId)?.avatar ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
  return { entries: entries.slice(0, limit), fullEntries: entries };
}

// Background data refresh — only the presenter uses this (to know whether
// any scores exist yet, for showing the leaderboard button at all). It does
// NOT make the leaderboard visible to participants; that's a separate,
// explicit show/hide broadcast below, so everyone sees it at the same time.
// Takes already-computed entries so callers that just ran computeLeaderboard
// (e.g. to grade a submission) don't pay for a second identical query.
function sendLeaderboardToPresenter(io: Server, s: LiveSession, entries: LeaderboardEntryRow[]) {
  if (!s.presenterSocketId) return;
  io.to(s.presenterSocketId).emit("leaderboard:updated", { entries });
}

interface LeaderboardEntryRow {
  participantId: string;
  name: string;
  score: number;
  avatar: number;
}

// Reveal a quiz slide to the whole room: broadcast the correct answer(s) and the
// current aggregate, then refresh the presenter's leaderboard. One-shot per slide
// (tracked via revealedSlides) — happens on time-up or once everyone has answered.
async function revealSlide(io: Server, joinCode: string, slide: LiveSession["slides"][number]) {
  const s = live.get(joinCode);
  if (!s) return;
  s.revealedSlides.add(slide.id);

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
  io.to(joinCode).emit("slide:reveal", payload);

  const { entries } = await computeLeaderboard(s);
  sendLeaderboardToPresenter(io, s, entries);
}

export function registerSessionHandlers(io: Server, socket: Socket) {
  // Q&A and reactions live in their own module but need to resolve the same
  // in-memory session map and reuse this file's presenter authorization.
  registerQaHandlers(io, socket, {
    sessionFor: (joinCode) => {
      const s = live.get(joinCode);
      return s ? { sessionId: s.sessionId, ownerId: s.ownerId, filterMode: s.filterMode } : undefined;
    },
    isPresenter: (payload) => {
      const s = payload?.joinCode ? live.get(payload.joinCode) : undefined;
      if (!s) return false;
      const auth = payload?.token ? verifyToken(payload.token) : null;
      return !!auth && auth.userId === s.ownerId;
    },
  });

  // Authorize a presenter command: the caller must supply a valid token whose
  // user owns this session. The join code alone is NOT sufficient — it's shown
  // on screen to every participant. On success we also refresh presenterSocketId
  // so presenter-only pushes (e.g. leaderboard:updated) survive a reconnect.
  function requirePresenter(payload: any, cb?: Function): LiveSession | null {
    const s = payload?.joinCode ? live.get(payload.joinCode) : undefined;
    if (!s) {
      reject(cb, "SESSION_GONE", "Session not found");
      return null;
    }
    const auth = payload?.token ? verifyToken(payload.token) : null;
    if (!auth || auth.userId !== s.ownerId) {
      reject(cb, "UNAUTHORIZED", "Unauthorized");
      return null;
    }
    s.presenterSocketId = socket.id;
    return s;
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
      presenterSocketId: socket.id,
      currentSlideStartedAt: null,
      revealTimer: null,
      revealedSlides: new Set(),
      revealPayloads: new Map(),
      participantSockets: new Map(),
      leaderboardView: null,
      navChain: Promise.resolve(),
    };
    live.set(joinCode, liveSession);

    socket.join(joinCode);
    socket.data.joinCode = joinCode;
    socket.data.role = "presenter";

    cb?.({
      joinCode,
      sessionId: session.id,
      pacing: liveSession.pacing,
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
    if (!joinCode || !found) return reject(cb, "NO_LIVE_SESSION", "No live session to resume");

    found.presenterSocketId = socket.id;
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
      // broadcast, so the client reduces both through one path.
      ...participantsPayload(found),
      // The presenter is the one party entitled to the answer key.
      currentSlide: current,
      revealed,
      // The stored frame is already the post-reveal one, so it carries whatever
      // the slide module exposes at reveal time — the presenter needs no
      // enriched variant, and keeping it byte-identical to what the room saw
      // means the stage cannot drift from the phones.
      reveal: revealed ? found.revealPayloads.get(current!.id) ?? null : null,
      startedAt: found.currentSlideStartedAt,
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
      leaderboardView: found.leaderboardView,
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
    io.to(socket.id).emit("participant:count", participantsPayload(found));
    const resumedSlide = currentSlideOf(found);
    if (resumedSlide) await emitResults(io, joinCode, resumedSlide.id);
    const { entries } = await computeLeaderboard(found);
    sendLeaderboardToPresenter(io, found, entries);
  });

  // The session row is gone (its deck was deleted mid-run). Drop the live
  // entry and tell the room, rather than carrying on against nothing. Shared
  // by both callers so the no-op path reports a dead deck the same way a real
  // move does — the host must not get a different story depending on which
  // key they happened to press.
  function sessionVanished(joinCode: string, cb?: Function) {
    live.delete(joinCode);
    io.to(joinCode).emit("session:ended", { entries: [] });
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
        data: { status: s.status, currentSlideId: currentSlideOf(s)?.id ?? null },
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

    s.currentIndex = clamped;
    s.status = clamped < 0 ? "LOBBY" : "ACTIVE";
    s.currentSlideStartedAt = clamped >= 0 ? Date.now() : null;

    const slide = currentSlideOf(s);

    // Landing on a quiz slide that hasn't been revealed yet: arm the time-up
    // auto-reveal. A revisit of an already-revealed slide keeps its reveal and
    // does NOT restart the timer.
    if (clamped >= 0 && slide && !s.revealedSlides.has(slide.id)) {
      const slideObj = s.slides[clamped];
      if (isTimed(slideObj.type, slideObj.config)) {
        s.revealTimer = setTimeout(
          () => revealSlide(io, joinCode, slideObj),
          scaledLimit(s, slideObj) * 1000
        );
      }
    }
    const persisted = await prisma.session.updateMany({
      where: { id: s.sessionId },
      data: { status: s.status, currentSlideId: slide?.id ?? null },
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
      // Authoritative countdown length, already scaled. The client must not
      // re-derive this from config or the ring and the auto-reveal disagree.
      timeLimitSec:
        clamped >= 0 && isTimed(s.slides[clamped].type, s.slides[clamped].config)
          ? scaledLimit(s, s.slides[clamped])
          : null,
    };
    io.to(joinCode)
      .except(s.presenterSocketId ?? "")
      .emit("slide:changed", { ...common, currentSlide: slide });
    if (s.presenterSocketId) {
      io.to(s.presenterSocketId).emit("slide:changed", {
        ...common,
        currentSlide: currentSlideOf(s, true),
      });
    }

    // Landing back on a slide that was already revealed: `slide:changed` on its
    // own looks identical to opening a fresh question, so the room gets a
    // ticking clock on a closed one and every submit comes back "Time's up".
    // Re-send the stored frame so the UI returns to its revealed state.
    if (slide && s.revealedSlides.has(slide.id)) {
      const stored = s.revealPayloads.get(slide.id);
      if (stored) io.to(joinCode).emit("slide:reveal", stored);
    }

    // push existing results for the new slide (in case of late reveal)
    if (slide) await emitResults(io, joinCode, slide.id);
    const { entries } = await computeLeaderboard(s);
    sendLeaderboardToPresenter(io, s, entries);

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

  socket.on("presenter:goto", (args, cb) => {
    const s = requirePresenter(args, cb);
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

  socket.on("presenter:next", (args, cb) => {
    const s = requirePresenter(args, cb);
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

  socket.on("presenter:prev", (args, cb) => {
    const s = requirePresenter(args, cb);
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
    const s = requirePresenter(args, cb);
    if (!s) return;
    const { entries } = await computeLeaderboard(s);
    cb?.({ ok: true, entries });
  });

  // ---- Presenter: reveal / hide the leaderboard for EVERYONE (presenter +
  // participants) at the same moment — this is what makes it a shared
  // "big screen" moment instead of presenter-only data. ----
  socket.on("presenter:show-leaderboard", async (args, cb) => {
    const s = requirePresenter(args, cb);
    if (!s) return;
    const { entries } = await computeLeaderboard(s);
    // Remember the exact frame the room is now looking at. A phone that
    // reloads during standings must come back into the same shared moment,
    // and it can only do that if the broadcast left something behind — we
    // keep the frame itself rather than recomputing at join time so the
    // reloader sees the board everyone else is reading, not a newer one.
    s.leaderboardView = { entries };
    io.to(args.joinCode).emit("leaderboard:show", { entries });
    cb?.({ ok: true, entries });
  });

  socket.on("presenter:hide-leaderboard", (args, cb) => {
    const s = requirePresenter(args, cb);
    if (!s) return;
    s.leaderboardView = null;
    io.to(args.joinCode).emit("leaderboard:hide", {});
    cb?.({ ok: true });
  });

  socket.on("presenter:end", async (args, cb) => {
    const s = requirePresenter(args, cb);
    if (!s) return;
    const joinCode = args.joinCode;
    // Idempotent: a second End (a double click, a retried ack) must not rewrite
    // `endedAt` — that overwrites the real end time the session is reported on —
    // nor re-broadcast `session:ended` to a room already on the podium. Ack with
    // the standings so the caller still gets a useful answer.
    if (s.status === "ENDED") {
      const { entries } = await computeLeaderboard(s);
      return cb?.({ ok: true, entries });
    }
    if (s.revealTimer) {
      clearTimeout(s.revealTimer);
      s.revealTimer = null;
    }
    s.status = "ENDED";
    await prisma.session.updateMany({
      where: { id: s.sessionId },
      data: { status: "ENDED", endedAt: new Date() },
    });
    const { entries } = await computeLeaderboard(s);
    io.to(joinCode).emit("session:ended", { entries });
    cb?.({ ok: true, entries });
  });

  // ---- Participant: join by code ----
  socket.on("participant:join", async ({ joinCode, participantId, name, avatar }, cb) => {
    const ip = clientIp(socket);
    if (tooManyJoinFailures(ip, participantId)) {
      return reject(cb, "RATE_LIMITED", "Too many attempts. Try again in a minute.");
    }
    const s = live.get(joinCode);
    if (!s) {
      recordJoinFailure(ip, participantId);
      return reject(cb, "BAD_CODE", "Invalid code");
    }
    if (s.status === "ENDED") return reject(cb, "SESSION_ENDED", "Session has ended");
    if (typeof participantId !== "string" || !participantId) {
      return reject(cb, "BAD_PARTICIPANT", "Invalid participant");
    }

    socket.join(joinCode);
    socket.data.joinCode = joinCode;
    socket.data.role = "participant";
    socket.data.participantId = participantId;
    // This socket is now the one that owns this identity. Disconnect consults
    // this to tell a stale tab's teardown apart from the real player leaving.
    s.participantSockets.set(participantId, socket.id);
    // preserve existing name/avatar if this participantId already joined (reconnect)
    const existing = s.participants.get(participantId);
    // Cap before filtering, matching `qa:ask`'s treatment of authorName. The
    // lobby chip and the leaderboard row have no defence against a 120-char
    // nickname, and the filter only masks content — it never truncates.
    const rawName = String(name ?? "").trim().slice(0, MAX_NICKNAME_LEN);
    s.participants.set(participantId, {
      name: filterNickname(rawName || existing?.name || "Anonymous"),
      avatar: typeof avatar === "number" ? avatar : existing?.avatar ?? 0,
    });

    io.to(joinCode).emit("participant:count", participantsPayload(s));

    const current = currentSlideOf(s);
    const idx = s.currentIndex;

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
    if (current) {
      const mine = await prisma.response.findUnique({
        where: {
          sessionId_slideId_participantId: {
            sessionId: s.sessionId,
            slideId: current.id,
            participantId,
          },
        },
        select: { value: true },
      });
      if (mine) {
        answered = true;
        myAnswer = safeParse(mine.value);
      }
    }

    cb?.({
      ok: true,
      status: s.status,
      index: idx,
      currentSlide: current,
      totalSlides: s.slides.length,
      startedAt: s.currentSlideStartedAt,
      // Authoritative, already scaled — same rule as `slide:changed`, so a
      // rejoining phone's ring agrees with the auto-reveal it is racing.
      timeLimitSec:
        idx >= 0 && isTimed(s.slides[idx].type, s.slides[idx].config)
          ? scaledLimit(s, s.slides[idx])
          : null,
      pacing: s.pacing,
      revealed,
      // Only ever populated once the slide is revealed, so this cannot become a
      // second path by which the answer key reaches a participant early.
      reveal: revealed ? s.revealPayloads.get(current!.id) ?? null : null,
      answered,
      myAnswer,
      // `leaderboard:show` is a one-shot broadcast, so a phone that reloads
      // while the projector is on the standings came back rendering the slide
      // — out of a moment the rest of the room is still sharing. Same
      // `{ entries }` shape as the broadcast, so the client unwraps one thing;
      // null whenever the board is not up, which is the common case.
      leaderboardView: s.leaderboardView,
    });
  });

  // ---- Participant: self-navigate (audience-paced decks only) ----
  socket.on("participant:goto", ({ joinCode, participantId, index }, cb) => {
    const s = live.get(joinCode);
    if (!s) return reject(cb, "SESSION_GONE", "Session not found");
    // The same guard `presenter:goto/next/prev` and `participant:submit` all
    // carry, and the only handler that was missed. Nothing can be scored once
    // the deck is ENDED, so the player was simply being served slides from a
    // finished deck: a live-looking question that silently answers nothing.
    if (s.status === "ENDED") return reject(cb, "SESSION_ENDED", "Session has ended");
    if (s.pacing !== "AUDIENCE") return reject(cb, "HOST_PACED", "The host is driving this deck");
    if (socket.data.role !== "participant" || socket.data.participantId !== participantId) {
      return reject(cb, "NOT_JOINED", "Join the session first");
    }
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
        const slide = publicSlide(s.slides[clamped]);
        // Only this socket is told — everyone else stays where they are, which
        // is the whole point of audience pacing.
        cb?.({
          ok: true,
          index: clamped,
          currentSlide: slide,
          totalSlides: s.slides.length,
          // Self-paced slides have no shared clock, so timed scoring is not
          // meaningful here; the client hides the countdown.
          startedAt: null,
        });
      })
      .catch((e) => {
        reject(cb, "NAV_FAILED", "Could not change slide");
        console.error("participant navigation failed", e);
      });
  });

  // ---- Participant: submit a response ----
  socket.on("participant:submit", async ({ joinCode, slideId, participantId, value }, cb) => {
    const s = live.get(joinCode);
    if (!s) return reject(cb, "SESSION_GONE", "Session not found");
    if (s.status === "ENDED") return reject(cb, "SESSION_ENDED", "Session has ended");
    // Bind the answer to the connection that joined: a socket can only submit
    // as the participantId it joined with, so one student can't overwrite
    // another's answer or inject leaderboard scores under an arbitrary id.
    if (socket.data.role !== "participant" || socket.data.participantId !== participantId) {
      return reject(cb, "NOT_JOINED", "Join the session before submitting");
    }
    const slide = s.slides.find((x) => x.id === slideId);
    if (!slide) return reject(cb, "SLIDE_GONE", "Slide not found");

    // Once a slide is revealed, answers are locked — the window has closed.
    if (s.revealedSlides.has(slideId)) return reject(cb, "TOO_LATE", "Time's up");

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

    const graded = gradeSubmission(
      slide.type,
      // Grade against the stretched window too — otherwise relaxed timing
      // quietly costs every player points for answering at the same relative
      // moment, turning an accessibility option into a scoring penalty.
      s.timeScale === 1 ? slide.config : { ...slide.config, timeLimitSec: scaledLimit(s, slide) },
      value,
      { slideStartedAt: s.currentSlideStartedAt, now: Date.now() }
    );

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
          value: JSON.stringify(value),
          correct: graded.correct,
          points: graded.points,
          ...asAsked,
        },
        update: {
          value: JSON.stringify(value),
          correct: graded.correct,
          points: graded.points,
          ...asAsked,
        },
      });
    } catch (e) {
      return reject(cb, "SAVE_FAILED", "Could not save response");
    }

    await emitResults(io, joinCode, slideId);

    if (isTimed(slide.type, slide.config)) {
      // Single leaderboard query, reused for both this participant's ack and
      // the presenter's live view — was previously computed twice per submit.
      const { entries, fullEntries } = await computeLeaderboard(s);
      const rank = fullEntries.findIndex((e) => e.participantId === participantId) + 1;
      const totalScore = fullEntries.find((e) => e.participantId === participantId)?.score ?? 0;
      sendLeaderboardToPresenter(io, s, entries);
      cb?.({ ok: true, isQuiz: true, correct: graded.correct, points: graded.points, totalScore, rank });

      // If everyone present has now answered this slide, reveal early rather
      // than waiting for the timer to expire. "Everyone present" has to be
      // measured over the people still in the room: a raw row count includes
      // players who answered and then dropped their socket (lock screen, wifi
      // hop, closed tab), whose rows outlive their entry in `participants`. A
      // single such leaver makes count >= size true while others are still
      // typing, and the premature reveal rejects their answers with "Time's up".
      const rows = await prisma.response.findMany({
        where: { sessionId: s.sessionId, slideId },
        select: { participantId: true },
      });
      const answeredPresent = rows.reduce(
        (n, r) => n + (s.participants.has(r.participantId) ? 1 : 0),
        0
      );
      if (
        answeredPresent >= s.participants.size &&
        s.participants.size > 0 &&
        !s.revealedSlides.has(slideId)
      ) {
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
  socket.on("disconnect", () => {
    const joinCode = socket.data.joinCode;
    const s = joinCode ? live.get(joinCode) : undefined;
    if (!s) return;
    // Evict only if this socket is still the one that owns the identity. A
    // player can have more than one socket alive — a second tab, a reconnect
    // whose old transport has not timed out yet — and the loser's teardown
    // used to delete the live player: they vanished from the lobby and, with
    // no entry left in `participants`, reached the podium as "Anonymous".
    const pid = socket.data.participantId;
    if (socket.data.role === "participant" && pid && s.participantSockets.get(pid) === socket.id) {
      s.participantSockets.delete(pid);
      s.participants.delete(pid);
      io.to(joinCode).emit("participant:count", participantsPayload(s));
    }
    // If the session is ending (presenter gone), tear down any pending reveal.
    if (s.status === "ENDED" && s.revealTimer) {
      clearTimeout(s.revealTimer);
      s.revealTimer = null;
    }
  });
}

/** A host can stretch every countdown, but not to the point of absurdity. */
function clampTimeScale(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 1;
  return Math.max(1, Math.min(3, n));
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
