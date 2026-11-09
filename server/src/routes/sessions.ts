import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { formatForExport } from "../slides/registry.js";

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

  // Who the ids belong to. The export used to emit a bare `participantId` — a
  // cuid — so the one artefact a host keeps after the session named nobody at
  // all. The id stays in its own column because it is the join key back to the
  // live data and to the Q&A rows; the name is simply now also present.
  const roster = new Map(
    (
      await prisma.participant.findMany({
        where: { sessionId: session.id },
        select: { participantId: true, name: true },
      })
    ).map((p) => [p.participantId, p.name])
  );

  const rows = [
    ["Slide Question", "Slide Type", "Participant", "Participant ID", "Answer", "Submitted At"],
  ];
  for (const r of session.responses) {
    // Read the question as it was ASKED, not as the deck reads today. A
    // session is a record of something that already happened; the slide row is
    // a living document the host keeps editing, and `value` is only meaningful
    // through the type and config it was answered under (a MULTIPLE_CHOICE
    // answer is an option index — re-label the options and every past export
    // starts reporting a different answer). The deliberate join on `slide` is
    // the fallback for rows written before the snapshot columns existed, and
    // it is also why the export must NOT filter `deletedAt`: a deleted slide
    // is exactly the one whose responses we still have to name.
    const type = r.slideType ?? r.slide.type;
    const config = r.slideConfig ?? r.slide.config;
    rows.push([
      r.slideQuestion ?? r.slide.question,
      type,
      // Rows written before the roster existed have no name to resolve; they
      // keep the behaviour they already had rather than inventing one.
      roster.get(r.participantId) ?? "Anonymous",
      r.participantId,
      formatForExport(type, safeParse(config), safeParse(r.value)),
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

function safeParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function csvEscape(s: string): string {
  const needsQuotes = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}
