import type { Server, Socket } from "socket.io";
import { prisma } from "../db.js";
import { verifyToken } from "../auth.js";
import { computeAggregate } from "../services/aggregate.js";
import { gradeSubmission } from "../services/scoring.js";

// In-memory live state per active session (keyed by joinCode).
interface LiveSession {
  sessionId: string;
  presentationId: string;
  ownerId: string;
  slides: { id: string; type: string; question: string; config: any; order: number }[];
  currentIndex: number; // -1 = lobby
  status: "LOBBY" | "ACTIVE" | "ENDED";
  participants: Map<string, { name: string }>;
  presenterSocketId: string | null;
  // wall-clock ms when the current slide became active — used to time quiz answers
  currentSlideStartedAt: number | null;
}

const live = new Map<string, LiveSession>();

// Throttle join-code guessing: the 6-digit space is only 900k, so an attacker
// could enumerate live sessions. Track failed join attempts per client IP in a
// sliding window and reject once too many pile up.
const JOIN_WINDOW_MS = 60_000;
const JOIN_MAX_FAILURES = 10;
const joinFailures = new Map<string, { count: number; resetAt: number }>();

function tooManyJoinFailures(ip: string): boolean {
  const rec = joinFailures.get(ip);
  return !!rec && Date.now() < rec.resetAt && rec.count >= JOIN_MAX_FAILURES;
}

function recordJoinFailure(ip: string) {
  const now = Date.now();
  const rec = joinFailures.get(ip);
  if (!rec || now >= rec.resetAt) {
    joinFailures.set(ip, { count: 1, resetAt: now + JOIN_WINDOW_MS });
  } else {
    rec.count++;
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

function genJoinCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function publicSlide(s: LiveSession["slides"][number]) {
  return { id: s.id, type: s.type, question: s.question, config: s.config, order: s.order };
}

function currentSlideOf(s: LiveSession) {
  if (s.currentIndex < 0 || s.currentIndex >= s.slides.length) return null;
  return publicSlide(s.slides[s.currentIndex]);
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
  io.to(joinCode).emit("results:updated", { slideId, aggregate });
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
}

export function registerSessionHandlers(io: Server, socket: Socket) {
  // Authorize a presenter command: the caller must supply a valid token whose
  // user owns this session. The join code alone is NOT sufficient — it's shown
  // on screen to every participant. On success we also refresh presenterSocketId
  // so presenter-only pushes (e.g. leaderboard:updated) survive a reconnect.
  function requirePresenter(payload: any, cb?: Function): LiveSession | null {
    const s = payload?.joinCode ? live.get(payload.joinCode) : undefined;
    if (!s) {
      cb?.({ error: "Session not found" });
      return null;
    }
    const auth = payload?.token ? verifyToken(payload.token) : null;
    if (!auth || auth.userId !== s.ownerId) {
      cb?.({ error: "Unauthorized" });
      return null;
    }
    s.presenterSocketId = socket.id;
    return s;
  }

  // ---- Presenter: create a live session from a presentation ----
  socket.on("presenter:create-session", async ({ token, presentationId }, cb) => {
    const auth = token ? verifyToken(token) : null;
    if (!auth) return cb?.({ error: "Unauthorized" });

    const presentation = await prisma.presentation.findFirst({
      where: { id: presentationId, ownerId: auth.userId },
      include: { slides: { orderBy: { order: "asc" } } },
    });
    if (!presentation) return cb?.({ error: "Presentation not found" });
    if (presentation.slides.length === 0) return cb?.({ error: "Add a slide first" });

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
    };
    live.set(joinCode, liveSession);

    socket.join(joinCode);
    socket.data.joinCode = joinCode;
    socket.data.role = "presenter";

    cb?.({
      joinCode,
      sessionId: session.id,
      status: liveSession.status,
      totalSlides: liveSession.slides.length,
      currentIndex: liveSession.currentIndex,
      currentSlide: currentSlideOf(liveSession),
    });
  });

  // ---- Presenter: navigate slides (used by goto / next / prev) ----
  // Callers must authorize via requirePresenter and pass the resolved session.
  async function goto(s: LiveSession, joinCode: string, index: number, cb?: Function) {
    const clamped = Math.max(-1, Math.min(index, s.slides.length - 1));
    s.currentIndex = clamped;
    s.status = clamped < 0 ? "LOBBY" : "ACTIVE";
    s.currentSlideStartedAt = clamped >= 0 ? Date.now() : null;

    const slide = currentSlideOf(s);
    await prisma.session.update({
      where: { id: s.sessionId },
      data: { status: s.status, currentSlideId: slide?.id ?? null },
    });

    io.to(joinCode).emit("slide:changed", {
      index: s.currentIndex,
      status: s.status,
      currentSlide: slide,
      totalSlides: s.slides.length,
      startedAt: s.currentSlideStartedAt,
    });

    // push existing results for the new slide (in case of late reveal)
    if (slide) await emitResults(io, joinCode, slide.id);
    const { entries } = await computeLeaderboard(s);
    sendLeaderboardToPresenter(io, s, entries);

    cb?.({ ok: true, index: s.currentIndex, currentSlide: slide });
  }

  socket.on("presenter:goto", (args, cb) => {
    const s = requirePresenter(args, cb);
    if (!s) return;
    goto(s, args.joinCode, args.index, cb);
  });

  socket.on("presenter:next", (args, cb) => {
    const s = requirePresenter(args, cb);
    if (!s) return;
    goto(s, args.joinCode, s.currentIndex + 1, cb);
  });

  socket.on("presenter:prev", (args, cb) => {
    const s = requirePresenter(args, cb);
    if (!s) return;
    goto(s, args.joinCode, s.currentIndex - 1, cb);
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
    io.to(args.joinCode).emit("leaderboard:show", { entries });
    cb?.({ ok: true, entries });
  });

  socket.on("presenter:hide-leaderboard", (args, cb) => {
    const s = requirePresenter(args, cb);
    if (!s) return;
    io.to(args.joinCode).emit("leaderboard:hide", {});
    cb?.({ ok: true });
  });

  socket.on("presenter:end", async (args, cb) => {
    const s = requirePresenter(args, cb);
    if (!s) return;
    const joinCode = args.joinCode;
    s.status = "ENDED";
    await prisma.session.update({ where: { id: s.sessionId }, data: { status: "ENDED" } });
    const { entries } = await computeLeaderboard(s);
    io.to(joinCode).emit("session:ended", { entries });
    cb?.({ ok: true, entries });
  });

  // ---- Participant: join by code ----
  socket.on("participant:join", ({ joinCode, participantId, name }, cb) => {
    const ip = clientIp(socket);
    if (tooManyJoinFailures(ip)) {
      return cb?.({ error: "Too many attempts. Try again in a minute." });
    }
    const s = live.get(joinCode);
    if (!s) {
      recordJoinFailure(ip);
      return cb?.({ error: "Invalid code" });
    }
    if (s.status === "ENDED") return cb?.({ error: "Session has ended" });

    socket.join(joinCode);
    socket.data.joinCode = joinCode;
    socket.data.role = "participant";
    socket.data.participantId = participantId;
    // preserve existing name/score if this participantId already joined (reconnect)
    const existing = s.participants.get(participantId);
    s.participants.set(participantId, { name: name || existing?.name || "Anonymous" });

    io.to(joinCode).emit("participant:count", { count: s.participants.size });

    const current = currentSlideOf(s);
    cb?.({
      ok: true,
      status: s.status,
      index: s.currentIndex,
      currentSlide: current,
      totalSlides: s.slides.length,
      startedAt: s.currentSlideStartedAt,
    });
  });

  // ---- Participant: submit a response ----
  socket.on("participant:submit", async ({ joinCode, slideId, participantId, value }, cb) => {
    const s = live.get(joinCode);
    if (!s) return cb?.({ error: "Session not found" });
    if (s.status === "ENDED") return cb?.({ error: "Session has ended" });
    // Bind the answer to the connection that joined: a socket can only submit
    // as the participantId it joined with, so one student can't overwrite
    // another's answer or inject leaderboard scores under an arbitrary id.
    if (socket.data.role !== "participant" || socket.data.participantId !== participantId) {
      return cb?.({ error: "Join the session before submitting" });
    }
    const slide = s.slides.find((x) => x.id === slideId);
    if (!slide) return cb?.({ error: "Slide not found" });

    const graded = gradeSubmission(slide.type, slide.config, value, s.currentSlideStartedAt);

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
        },
        update: {
          value: JSON.stringify(value),
          correct: graded.correct,
          points: graded.points,
        },
      });
    } catch (e) {
      return cb?.({ error: "Could not save response" });
    }

    await emitResults(io, joinCode, slideId);

    if (slide.config?.isQuiz) {
      // Single leaderboard query, reused for both this participant's ack and
      // the presenter's live view — was previously computed twice per submit.
      const { entries, fullEntries } = await computeLeaderboard(s);
      const rank = fullEntries.findIndex((e) => e.participantId === participantId) + 1;
      const totalScore = fullEntries.find((e) => e.participantId === participantId)?.score ?? 0;
      sendLeaderboardToPresenter(io, s, entries);
      cb?.({ ok: true, isQuiz: true, correct: graded.correct, points: graded.points, totalScore, rank });
    } else {
      cb?.({ ok: true, isQuiz: false });
    }
  });

  // ---- Disconnect ----
  socket.on("disconnect", () => {
    const joinCode = socket.data.joinCode;
    const s = joinCode ? live.get(joinCode) : undefined;
    if (!s) return;
    if (socket.data.role === "participant" && socket.data.participantId) {
      s.participants.delete(socket.data.participantId);
      io.to(joinCode).emit("participant:count", { count: s.participants.size });
    }
  });
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
