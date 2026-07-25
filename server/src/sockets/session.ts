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
async function sendLeaderboardToPresenter(io: Server, s: LiveSession) {
  if (!s.presenterSocketId) return;
  const { entries } = await computeLeaderboard(s);
  io.to(s.presenterSocketId).emit("leaderboard:updated", { entries });
}

export function registerSessionHandlers(io: Server, socket: Socket) {
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
  async function goto(joinCode: string, index: number, cb?: Function) {
    const s = live.get(joinCode);
    if (!s) return cb?.({ error: "Session not found" });

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
    await sendLeaderboardToPresenter(io, s);

    cb?.({ ok: true, index: s.currentIndex, currentSlide: slide });
  }

  socket.on("presenter:goto", ({ joinCode, index }, cb) => goto(joinCode, index, cb));

  socket.on("presenter:next", (args, cb) => {
    const s = live.get(args?.joinCode);
    if (!s) return cb?.({ error: "Session not found" });
    goto(args.joinCode, s.currentIndex + 1, cb);
  });

  socket.on("presenter:prev", (args, cb) => {
    const s = live.get(args?.joinCode);
    if (!s) return cb?.({ error: "Session not found" });
    goto(args.joinCode, s.currentIndex - 1, cb);
  });

  // ---- Presenter: request the current leaderboard on demand ----
  socket.on("presenter:get-leaderboard", async ({ joinCode }, cb) => {
    const s = live.get(joinCode);
    if (!s) return cb?.({ error: "Session not found" });
    const { entries } = await computeLeaderboard(s);
    cb?.({ ok: true, entries });
  });

  // ---- Presenter: reveal / hide the leaderboard for EVERYONE (presenter +
  // participants) at the same moment — this is what makes it a shared
  // "big screen" moment instead of presenter-only data. ----
  socket.on("presenter:show-leaderboard", async ({ joinCode }, cb) => {
    const s = live.get(joinCode);
    if (!s) return cb?.({ error: "Session not found" });
    const { entries } = await computeLeaderboard(s);
    io.to(joinCode).emit("leaderboard:show", { entries });
    cb?.({ ok: true, entries });
  });

  socket.on("presenter:hide-leaderboard", ({ joinCode }, cb) => {
    const s = live.get(joinCode);
    if (!s) return cb?.({ error: "Session not found" });
    io.to(joinCode).emit("leaderboard:hide", {});
    cb?.({ ok: true });
  });

  socket.on("presenter:end", async ({ joinCode }, cb) => {
    const s = live.get(joinCode);
    if (!s) return cb?.({ error: "Session not found" });
    s.status = "ENDED";
    await prisma.session.update({ where: { id: s.sessionId }, data: { status: "ENDED" } });
    const { entries } = await computeLeaderboard(s);
    io.to(joinCode).emit("session:ended", { entries });
    cb?.({ ok: true, entries });
  });

  // ---- Participant: join by code ----
  socket.on("participant:join", ({ joinCode, participantId, name }, cb) => {
    const s = live.get(joinCode);
    if (!s) return cb?.({ error: "Invalid code" });
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
      const { fullEntries } = await computeLeaderboard(s);
      const rank = fullEntries.findIndex((e) => e.participantId === participantId) + 1;
      const totalScore = fullEntries.find((e) => e.participantId === participantId)?.score ?? 0;
      await sendLeaderboardToPresenter(io, s);
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
