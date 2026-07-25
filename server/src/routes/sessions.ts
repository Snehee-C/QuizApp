import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";

export const sessionsRouter = Router();

sessionsRouter.use(requireAuth);

// CSV export of all responses in a session, grouped by slide.
sessionsRouter.get("/:sessionId/export", async (req: AuthedRequest, res) => {
  const session = await prisma.session.findUnique({
    where: { id: req.params.sessionId },
    include: {
      presentation: true,
      responses: { include: { slide: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!session || session.presentation.ownerId !== req.auth!.userId) {
    return res.status(404).json({ error: "Not found" });
  }

  const rows = [["Slide Question", "Slide Type", "Participant", "Answer", "Submitted At"]];
  for (const r of session.responses) {
    rows.push([
      r.slide.question,
      r.slide.type,
      r.participantId,
      formatValue(r.value),
      r.createdAt.toISOString(),
    ]);
  }
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="session-${session.joinCode}-results.csv"`
  );
  res.send(csv);
});

function formatValue(raw: string): string {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.join("; ") : String(v);
  } catch {
    return raw;
  }
}

function csvEscape(s: string): string {
  const needsQuotes = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}
