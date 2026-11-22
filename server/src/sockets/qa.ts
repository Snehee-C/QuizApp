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
//
// The same fixed window now guards Q&A, which had none: every `qa:ask` is a
// row written and a personalised re-render pushed to every socket in the room,
// so one looping phone could flood the host's moderation queue and slow the
// live room for everybody. A person asks a few questions an hour; the limits
// are set where no honest thumb reaches them.
function fixedWindowLimiter(windowMs: number, max: number): (key: string) => boolean {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key) => {
    const now = Date.now();
    // One entry per (session, participant) and nothing ever removed them, so
    // the map was a slow accumulation of every person who had ever tapped on
    // this process. A window that has expired carries no information, so drop
    // the expired ones whenever the map gets large — the same sweep the join
    // throttle already does, for the same reason.
    if (buckets.size > 1000) {
      for (const [k, rec] of buckets) if (now >= rec.resetAt) buckets.delete(k);
    }
    const b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (b.count >= max) return false;
    b.count++;
    return true;
  };
}

const reactionAllowed = fixedWindowLimiter(1000, 5);
const askAllowed = fixedWindowLimiter(60_000, 5);
const voteAllowed = fixedWindowLimiter(10_000, 20);

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
  /**
   * Resolve the live session for a join code, or undefined.
   *
   * Asynchronous because a room is no longer only what this process happens to
   * remember: after a restart it is rebuilt from the database on first use, and
   * the Q&A feed has to be able to follow the room back rather than answering
   * SESSION_GONE for a session that is demonstrably still running.
   */
  sessionFor: (joinCode: string) => Promise<{ sessionId: string; ownerId: string; filterMode: FilterMode } | undefined>;
  /** Verify the caller is that session's host. */
  isPresenter: (payload: any) => Promise<boolean>;
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
    const live = await deps.sessionFor(joinCode);
    if (!live) return reject(cb, "SESSION_GONE", "Session not found");
    // Who you are AND which room you are in. `qa:list` already pins both; its
    // four siblings checked only the first, so a socket seated in one session
    // could post into another's queue.
    if (
      socket.data.role !== "participant" ||
      socket.data.participantId !== participantId ||
      socket.data.joinCode !== joinCode
    ) {
      return reject(cb, "NOT_JOINED", "Join the session first");
    }
    if (!askAllowed(`${joinCode}:${participantId}`)) {
      return reject(cb, "RATE_LIMITED", "That's a lot of questions — give it a minute.");
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
    const live = await deps.sessionFor(joinCode);
    if (!live) return reject(cb, "SESSION_GONE", "Session not found");
    if (
      socket.data.role !== "participant" ||
      socket.data.participantId !== participantId ||
      socket.data.joinCode !== joinCode
    ) {
      return reject(cb, "NOT_JOINED", "Join the session first");
    }
    if (!voteAllowed(`${joinCode}:${participantId}`)) {
      return reject(cb, "RATE_LIMITED", "Slow down a moment.");
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
    if (!(await deps.isPresenter(args))) return reject(cb, "UNAUTHORIZED", "Unauthorized");
    const live = await deps.sessionFor(args.joinCode);
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
    const live = await deps.sessionFor(joinCode);
    if (!live) return reject(cb, "SESSION_GONE", "Session not found");

    // A token proves ownership even on a fresh socket (a presenter who
    // reloaded); socket.data.role covers the presenter's existing socket, which
    // is what the moderation and stage panels actually use. Pin it to THIS join
    // code so hosting one session is not a key to every other session's queue.
    const isHost =
      (await deps.isPresenter(args)) ||
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
  socket.on("reaction:send", async ({ joinCode, kind }) => {
    // The same room check its siblings now carry. A socket that had joined
    // nothing could previously put a burst of emoji on any projector it knew
    // the code of, which is a wall anyone can read.
    if (socket.data.joinCode !== joinCode) return;
    const live = await deps.sessionFor(joinCode);
    if (!live) return;
    if (!ALLOWED_REACTIONS.includes(kind)) return;
    const who = socket.data.participantId ?? socket.id;
    if (!reactionAllowed(`${joinCode}:${who}`)) return;
    // No ack: a dropped reaction is not worth a round trip.
    io.to(joinCode).emit("reaction:burst", { kind });
  });
}
