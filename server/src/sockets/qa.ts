import type { Server, Socket } from "socket.io";
import { prisma } from "../db.js";
import { filterNickname, filterText, type FilterMode } from "../services/contentFilter.js";
// Type-only, so it is erased at compile time: qa.ts gains the one canonical
// table of rejection reasons without a runtime import back into session.ts,
// which already imports this module and would otherwise form a cycle.
import type { RejectCode } from "./session.js";

// Audience Q&A + live reactions.
//
// Q&A is persisted (a host wants the questions after the session); reactions
// are deliberately NOT — they are a momentary burst of emoji on the big screen,
// and storing tens of thousands of rows for something nobody reads back would
// be waste.

export interface QaQuestion {
  id: string;
  text: string;
  authorName: string;
  status: string;
  votes: number;
  createdAt: number;
  /** Whether THIS participant has voted — filled in per recipient. */
  mine?: boolean;
}

const MAX_QUESTION_LEN = 280;

// Every rejection carries a stable `code` beside its human `error`, exactly as
// the session handlers do — the promise clients are being asked to rely on is
// "no ack ever has to be matched on wording", and that is only true if it holds
// in every handler, not most of them. The `error` strings are unchanged to the
// byte so a client that predates `code` still behaves identically. The helper
// is three lines and deliberately duplicated rather than imported: `RejectCode`
// above is the part that must not fork, and importing a value would make the
// module graph circular for no gain.
function reject(cb: Function | undefined, code: RejectCode, error: string) {
  cb?.({ error, code });
}

// Reaction flood control: one participant may fire a handful per second, no
// more. Without this a single held finger becomes a denial-of-service on every
// other phone in the room.
const REACTION_WINDOW_MS = 1000;
const REACTION_MAX_PER_WINDOW = 5;
const reactionBuckets = new Map<string, { count: number; resetAt: number }>();

function reactionAllowed(key: string): boolean {
  const now = Date.now();
  const b = reactionBuckets.get(key);
  if (!b || now >= b.resetAt) {
    reactionBuckets.set(key, { count: 1, resetAt: now + REACTION_WINDOW_MS });
    return true;
  }
  if (b.count >= REACTION_MAX_PER_WINDOW) return false;
  b.count++;
  return true;
}

/** Only these reach the stage — anything else is dropped rather than rendered. */
export const ALLOWED_REACTIONS = ["heart", "fire", "clap", "laugh", "wow", "think"] as const;

export async function loadQuestions(sessionId: string): Promise<QaQuestion[]> {
  const rows = await prisma.question.findMany({
    where: { sessionId, status: { not: "HIDDEN" } },
    include: { _count: { select: { votes: true } }, votes: { select: { participantId: true } } },
  });
  return rows
    .map((q) => ({
      id: q.id,
      participantId: q.participantId,
      text: q.text,
      authorName: q.authorName,
      status: q.status,
      votes: q._count.votes,
      createdAt: q.createdAt.getTime(),
      voters: q.votes.map((v) => v.participantId),
    }))
    // Most-upvoted first; ties broken oldest-first so a question doesn't jump
    // around the list every time someone else asks one.
    .sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt) as any;
}

/** Statuses the room is allowed to see. PENDING is deliberately not here. */
const PUBLIC_STATUSES = new Set(["APPROVED", "ANSWERED"]);

/**
 * Q&A state is shared, but what you may SEE is not.
 *
 * A PENDING question has not been moderated yet, so it must not reach other
 * participants' phones any more than it may reach the projector — otherwise
 * moderation only protects the big screen and the room still sees whatever
 * anyone typed. Each recipient therefore gets: everything approved, plus their
 * own pending questions so they can see theirs is waiting. The host gets the
 * lot, because triaging is their job.
 *
 * "Did I vote for this" is also per-person, so the same pass stamps `mine`.
 */
export function personalise(
  list: any[],
  participantId: string | undefined,
  isHost = false
): QaQuestion[] {
  return list
    .filter(
      (q) =>
        isHost ||
        PUBLIC_STATUSES.has(q.status) ||
        (participantId !== undefined && q.participantId === participantId)
    )
    .map(({ voters, participantId: _author, ...q }) => ({
      ...q,
      mine: participantId ? voters.includes(participantId) : false,
    }));
}

interface QaDeps {
  /** Resolve the live session for a join code, or undefined. */
  sessionFor: (joinCode: string) => { sessionId: string; ownerId: string; filterMode: FilterMode } | undefined;
  /** Verify the caller is that session's host. */
  isPresenter: (payload: any) => boolean;
}

export function registerQaHandlers(io: Server, socket: Socket, deps: QaDeps) {
  async function broadcast(joinCode: string, sessionId: string) {
    const raw = await loadQuestions(sessionId);
    // Each socket in the room gets its own view, stamped with that
    // participant's votes.
    const sockets = await io.in(joinCode).fetchSockets();
    for (const s of sockets) {
      s.emit("qa:updated", {
        questions: personalise(
          raw as any,
          s.data?.participantId,
          s.data?.role === "presenter"
        ),
      });
    }
  }

  socket.on("qa:ask", async ({ joinCode, participantId, name, text }, cb) => {
    const live = deps.sessionFor(joinCode);
    if (!live) return reject(cb, "SESSION_GONE", "Session not found");
    if (socket.data.role !== "participant" || socket.data.participantId !== participantId) {
      return reject(cb, "NOT_JOINED", "Join the session first");
    }
    const raw = String(text ?? "").trim().slice(0, MAX_QUESTION_LEN);
    if (!raw) return reject(cb, "EMPTY_QUESTION", "Write a question first");
    // A question is read aloud and projected, so it gets the same treatment as
    // any other participant text — moderation is a second line, not the first.
    const filtered = filterText(raw, live.filterMode);
    if (filtered.rejected) return reject(cb, "FILTERED", "Let's keep it friendly — try rephrasing.");
    const clean = filtered.text;

    await prisma.question.create({
      data: {
        sessionId: live.sessionId,
        participantId,
        authorName: filterNickname(String(name ?? "Anonymous").slice(0, 24) || "Anonymous"),
        text: clean,
      },
    });
    await broadcast(joinCode, live.sessionId);
    cb?.({ ok: true });
  });

  socket.on("qa:vote", async ({ joinCode, participantId, questionId }, cb) => {
    const live = deps.sessionFor(joinCode);
    if (!live) return reject(cb, "SESSION_GONE", "Session not found");
    if (socket.data.role !== "participant" || socket.data.participantId !== participantId) {
      return reject(cb, "NOT_JOINED", "Join the session first");
    }
    const q = await prisma.question.findFirst({
      where: { id: questionId, sessionId: live.sessionId },
      select: { id: true },
    });
    if (!q) return reject(cb, "QUESTION_GONE", "Question not found");

    // Toggle: a second tap removes the vote. The unique constraint makes this
    // idempotent even if two taps race.
    const existing = await prisma.questionVote.findUnique({
      where: { questionId_participantId: { questionId, participantId } },
      select: { id: true },
    });
    if (existing) {
      await prisma.questionVote.delete({ where: { id: existing.id } });
    } else {
      await prisma.questionVote
        .create({ data: { questionId, participantId } })
        .catch(() => {}); // lost race = already voted, which is the desired state
    }
    await broadcast(joinCode, live.sessionId);
    cb?.({ ok: true });
  });

  // ---- host moderation ----
  socket.on("qa:moderate", async (args, cb) => {
    if (!deps.isPresenter(args)) return reject(cb, "UNAUTHORIZED", "Unauthorized");
    const live = deps.sessionFor(args.joinCode);
    if (!live) return reject(cb, "SESSION_GONE", "Session not found");
    const { questionId, status } = args;
    if (!["PENDING", "APPROVED", "ANSWERED", "HIDDEN"].includes(status)) {
      return reject(cb, "BAD_STATUS", "Bad status");
    }
    await prisma.question.updateMany({
      where: { id: questionId, sessionId: live.sessionId },
      data: { status },
    });
    await broadcast(args.joinCode, live.sessionId);
    cb?.({ ok: true });
  });

  // A pull of the same feed `broadcast()` pushes. The push path is safe because
  // it walks real sockets and reads each one's own `socket.data`; this pull path
  // must derive identity exactly the same way.
  //
  // Threat model: the join code is projected on a wall, and `participant:count`
  // hands every phone every other phone's participantId, so BOTH are public
  // knowledge — neither can authorize anything. If this handler trusted the
  // `participantId` in the payload, anyone who can read the screen could claim
  // to be any player and `personalise()` would hand back that player's
  // unmoderated PENDING text. So the caller's claim is ignored entirely:
  //
  //   - who you are      -> socket.data.participantId, set by participant:join
  //   - which room       -> socket.data.joinCode, set by the same join
  //   - whether you host -> a presenter token, or this socket's own presenter
  //                         role for this very join code
  //
  // A socket that never joined gets nothing, and a member of another session
  // gets nothing, both before a single row is read.
  socket.on("qa:list", async (args, cb) => {
    const joinCode = args?.joinCode;
    const live = deps.sessionFor(joinCode);
    if (!live) return reject(cb, "SESSION_GONE", "Session not found");

    // A token proves ownership even on a fresh socket (a presenter who
    // reloaded); socket.data.role covers the presenter's existing socket, which
    // is what the moderation and stage panels actually use. Pin it to THIS join
    // code so hosting one session is not a key to every other session's queue.
    const isHost =
      deps.isPresenter(args) ||
      (socket.data?.role === "presenter" && socket.data?.joinCode === joinCode);

    const viewerId =
      socket.data?.role === "participant" && socket.data?.joinCode === joinCode
        ? (socket.data.participantId as string | undefined)
        : undefined;

    if (!isHost && viewerId === undefined) {
      return reject(cb, "NOT_JOINED", "Join the session first");
    }

    const raw = await loadQuestions(live.sessionId);
    cb?.({ ok: true, questions: personalise(raw as any, viewerId, isHost) });
  });

  // ---- live reactions (ephemeral) ----
  socket.on("reaction:send", ({ joinCode, kind }) => {
    const live = deps.sessionFor(joinCode);
    if (!live) return;
    if (!ALLOWED_REACTIONS.includes(kind)) return;
    const who = socket.data.participantId ?? socket.id;
    if (!reactionAllowed(`${joinCode}:${who}`)) return;
    // No ack: a dropped reaction is not worth a round trip.
    io.to(joinCode).emit("reaction:burst", { kind });
  });
}
