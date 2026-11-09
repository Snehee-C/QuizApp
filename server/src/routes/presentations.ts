import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { VALID_SLIDE_TYPES } from "../slides/registry.js";

export const presentationsRouter = Router();

presentationsRouter.use(requireAuth);

// Allow-list comes from the slide registry, so registering a type is the
// only step needed to make it creatable.
const VALID_TYPES = VALID_SLIDE_TYPES;

// Deleting a slide leaves a tombstone so the responses of finished sessions
// keep resolving (schema.prisma, Slide.deletedAt). The flip side is that every
// read which presents a deck as "the slides it has" must exclude them, or a
// deleted slide walks back into the editor, an export or a new session. One
// spelling of the filter, so a reviewer can grep `LIVE_SLIDES` and see all of
// them at once rather than diffing seven inline where-clauses.
const LIVE_SLIDES = { deletedAt: null } as const;
/** The same rule, for the slide counts shown on deck cards. */
const LIVE_SLIDE_COUNT = { _count: { select: { slides: { where: LIVE_SLIDES } } } } as const;

// List my presentations
presentationsRouter.get("/", async (req: AuthedRequest, res) => {
  const items = await prisma.presentation.findMany({
    where: { ownerId: req.auth!.userId },
    orderBy: { updatedAt: "desc" },
    include: LIVE_SLIDE_COUNT,
  });
  res.json(items);
});

// Create a presentation
presentationsRouter.post("/", async (req: AuthedRequest, res) => {
  const { title } = req.body ?? {};
  const item = await prisma.presentation.create({
    data: { title: title || "Untitled presentation", ownerId: req.auth!.userId },
  });
  res.json(item);
});

// Get one presentation with slides
presentationsRouter.get("/:id", async (req: AuthedRequest, res) => {
  const item = await prisma.presentation.findFirst({
    where: { id: req.params.id, ownerId: req.auth!.userId },
    include: { slides: { where: LIVE_SLIDES, orderBy: { order: "asc" } } },
  });
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

// Update presentation title
presentationsRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const owned = await prisma.presentation.findFirst({
    where: { id: req.params.id, ownerId: req.auth!.userId },
  });
  if (!owned) return res.status(404).json({ error: "Not found" });
  const { title, theme, pacing, isTemplate, filterMode, timeScale } = req.body ?? {};
  const item = await prisma.presentation.update({
    where: { id: req.params.id },
    data: {
      title: title ?? owned.title,
      theme: typeof theme === "string" ? theme : owned.theme,
      pacing: pacing === "AUDIENCE" || pacing === "PRESENTER" ? pacing : owned.pacing,
      isTemplate: typeof isTemplate === "boolean" ? isTemplate : owned.isTemplate,
      filterMode: ["off", "mask", "block"].includes(filterMode) ? filterMode : owned.filterMode,
      timeScale:
        typeof timeScale === "number" && Number.isFinite(timeScale)
          ? Math.max(1, Math.min(3, timeScale))
          : owned.timeScale,
    },
  });
  res.json(item);
});

// Delete presentation
presentationsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const owned = await prisma.presentation.findFirst({
    where: { id: req.params.id, ownerId: req.auth!.userId },
  });
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.presentation.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// --- Slides ---

async function assertOwnedPresentation(userId: string, presentationId: string) {
  return prisma.presentation.findFirst({
    where: { id: presentationId, ownerId: userId },
  });
}

// Add a slide
presentationsRouter.post("/:id/slides", async (req: AuthedRequest, res) => {
  const owned = await assertOwnedPresentation(req.auth!.userId, req.params.id);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { type, question, config } = req.body ?? {};
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: "Invalid slide type" });
  }
  // Append after the highest order ever used in this deck, tombstones
  // INCLUDED. A count of the live slides reuses the order of whatever was
  // removed, which collides with a surviving slide (delete the middle of
  // 0,1,2 and the count is 2, the same order the last slide already holds)
  // and leaves `orderBy: order` to break the tie arbitrarily — the deck
  // reshuffles itself. `order` is a monotonic sequence, not a position.
  const last = await prisma.slide.findFirst({
    where: { presentationId: req.params.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const slide = await prisma.slide.create({
    data: {
      presentationId: req.params.id,
      order: last ? last.order + 1 : 0,
      type,
      question: question || "",
      config: JSON.stringify(config ?? defaultConfig(type)),
    },
  });
  await prisma.presentation.update({
    where: { id: req.params.id },
    data: { updatedAt: new Date() },
  });
  res.json(slide);
});

// Update a slide
presentationsRouter.patch("/:id/slides/:slideId", async (req: AuthedRequest, res) => {
  const owned = await assertOwnedPresentation(req.auth!.userId, req.params.id);
  if (!owned) return res.status(404).json({ error: "Not found" });

  const { question, config, type, notes } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (question !== undefined) data.question = question;
  if (type !== undefined && VALID_TYPES.includes(type)) data.type = type;
  if (config !== undefined) data.config = JSON.stringify(config);
  // Speaker notes: presenter-only, capped so a runaway paste can't bloat the
  // row (and the create-session payload that carries every slide's notes).
  if (notes !== undefined) data.notes = String(notes).slice(0, 4000);

  // Scope the write to this presentation so a slideId belonging to someone
  // else's presentation can't be edited by passing your own :id. `deletedAt`
  // is part of that scope: a tombstone is no longer part of the deck, and the
  // only thing still reading it is the history of sessions that used it, which
  // a stale editor tab must not be able to rewrite.
  const result = await prisma.slide.updateMany({
    where: { id: req.params.slideId, presentationId: req.params.id, ...LIVE_SLIDES },
    data,
  });
  if (result.count === 0) return res.status(404).json({ error: "Not found" });
  const slide = await prisma.slide.findUnique({ where: { id: req.params.slideId } });
  res.json(slide);
});

// Delete a slide — a tombstone, not a row delete.
//
// The row is what the responses of every session ever run from this deck point
// at, and the FK cascades: a real DELETE here took the answers, the scores and
// the CSV rows of finished sessions with it, and did it silently. Stamping
// `deletedAt` removes the slide from the deck (every list read filters on it)
// while leaving the record of what already happened intact. The wire contract
// is unchanged — still 200/`{ok:true}`, still 404 on a second delete, since
// a tombstone no longer matches `deletedAt: null`.
presentationsRouter.delete("/:id/slides/:slideId", async (req: AuthedRequest, res) => {
  const owned = await assertOwnedPresentation(req.auth!.userId, req.params.id);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const result = await prisma.slide.updateMany({
    where: { id: req.params.slideId, presentationId: req.params.id, ...LIVE_SLIDES },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// Reorder slides — body: { order: [slideId, slideId, ...] }
presentationsRouter.post("/:id/slides/reorder", async (req: AuthedRequest, res) => {
  const owned = await assertOwnedPresentation(req.auth!.userId, req.params.id);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const order: string[] = req.body?.order ?? [];
  // Only reorder slides that actually belong to this presentation — reject if
  // the request references any foreign slideId.
  const ownedSlides = await prisma.slide.findMany({
    where: { presentationId: req.params.id, ...LIVE_SLIDES },
    select: { id: true },
  });
  const ownedIds = new Set(ownedSlides.map((s) => s.id));
  if (!order.every((slideId) => ownedIds.has(slideId))) {
    return res.status(400).json({ error: "Invalid slide in order" });
  }
  await prisma.$transaction(
    order.map((slideId, idx) =>
      prisma.slide.update({ where: { id: slideId }, data: { order: idx } })
    )
  );
  res.json({ ok: true });
});

function defaultConfig(type: string) {
  switch (type) {
    case "MULTIPLE_CHOICE":
      return {
        options: ["Option 1", "Option 2"],
        isQuiz: false,
        correctIndices: [0],
        timeLimitSec: 20,
      };
    case "SCALE":
      return { scaleMin: 1, scaleMax: 5 };
    case "WORD_CLOUD":
      return { maxWords: 3 };
    case "OPEN_ENDED":
      return {};
    default:
      return {};
  }
}


// ---- Duplicate a deck (also the "use this template" path) ----
// A template is just a deck flagged as one, so cloning is the same operation
// either way — which keeps there from being two divergent copy paths.
presentationsRouter.post("/:id/duplicate", async (req: AuthedRequest, res) => {
  const source = await prisma.presentation.findFirst({
    where: {
      id: req.params.id,
      // You may clone your own decks, or anyone's template.
      OR: [{ ownerId: req.auth!.userId }, { isTemplate: true }],
    },
    // Tombstones are not part of the deck, so a copy must not inherit them —
    // a cloned template would otherwise carry slides its owner deleted.
    include: { slides: { where: LIVE_SLIDES, orderBy: { order: "asc" } } },
  });
  if (!source) return res.status(404).json({ error: "Not found" });

  const copy = await prisma.presentation.create({
    data: {
      ownerId: req.auth!.userId,
      title: req.body?.title || `${source.title} (copy)`,
      theme: source.theme,
      pacing: source.pacing,
      filterMode: source.filterMode,
      timeScale: source.timeScale,
      // A copy is never itself a template unless the owner says so later.
      isTemplate: false,
      slides: {
        create: source.slides.map((s) => ({
          order: s.order,
          type: s.type,
          question: s.question,
          config: s.config,
          notes: s.notes,
        })),
      },
    },
    include: LIVE_SLIDE_COUNT,
  });
  res.json(copy);
});

// ---- Templates available to this user ----
presentationsRouter.get("/library/templates", async (req: AuthedRequest, res) => {
  const items = await prisma.presentation.findMany({
    where: { isTemplate: true },
    orderBy: { updatedAt: "desc" },
    include: { ...LIVE_SLIDE_COUNT, owner: { select: { name: true } } },
  });
  res.json(items);
});

// ---- Past runs of a deck ----
presentationsRouter.get("/:id/sessions", async (req: AuthedRequest, res) => {
  const owned = await prisma.presentation.findFirst({
    where: { id: req.params.id, ownerId: req.auth!.userId },
    select: { id: true },
  });
  if (!owned) return res.status(404).json({ error: "Not found" });

  const sessions = await prisma.session.findMany({
    where: { presentationId: req.params.id },
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { _count: { select: { responses: true, questions: true } } },
  });
  // Participant count isn't stored (presence is in-memory), so it's derived
  // from how many distinct people actually answered something.
  const withCounts = await Promise.all(
    sessions.map(async (s) => {
      const distinct = await prisma.response.findMany({
        where: { sessionId: s.id },
        select: { participantId: true },
        distinct: ["participantId"],
      });
      return {
        id: s.id,
        joinCode: s.joinCode,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        responses: s._count.responses,
        questions: s._count.questions,
        participants: distinct.length,
      };
    })
  );
  res.json(withCounts);
});
