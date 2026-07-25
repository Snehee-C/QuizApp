import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";

export const presentationsRouter = Router();

presentationsRouter.use(requireAuth);

const VALID_TYPES = ["MULTIPLE_CHOICE", "WORD_CLOUD", "SCALE", "OPEN_ENDED"];

// List my presentations
presentationsRouter.get("/", async (req: AuthedRequest, res) => {
  const items = await prisma.presentation.findMany({
    where: { ownerId: req.auth!.userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { slides: true } } },
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
    include: { slides: { orderBy: { order: "asc" } } },
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
  const item = await prisma.presentation.update({
    where: { id: req.params.id },
    data: { title: req.body?.title ?? owned.title },
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
  const count = await prisma.slide.count({ where: { presentationId: req.params.id } });
  const slide = await prisma.slide.create({
    data: {
      presentationId: req.params.id,
      order: count,
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

  const { question, config, type } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (question !== undefined) data.question = question;
  if (type !== undefined && VALID_TYPES.includes(type)) data.type = type;
  if (config !== undefined) data.config = JSON.stringify(config);

  const slide = await prisma.slide.update({
    where: { id: req.params.slideId },
    data,
  });
  res.json(slide);
});

// Delete a slide
presentationsRouter.delete("/:id/slides/:slideId", async (req: AuthedRequest, res) => {
  const owned = await assertOwnedPresentation(req.auth!.userId, req.params.id);
  if (!owned) return res.status(404).json({ error: "Not found" });
  await prisma.slide.delete({ where: { id: req.params.slideId } });
  res.json({ ok: true });
});

// Reorder slides — body: { order: [slideId, slideId, ...] }
presentationsRouter.post("/:id/slides/reorder", async (req: AuthedRequest, res) => {
  const owned = await assertOwnedPresentation(req.auth!.userId, req.params.id);
  if (!owned) return res.status(404).json({ error: "Not found" });
  const order: string[] = req.body?.order ?? [];
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
        allowMultiple: false,
        isQuiz: false,
        correctIndex: 0,
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
