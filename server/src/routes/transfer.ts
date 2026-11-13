// Deck portability — export a deck to a JSON file, import one back.
//
// An exported file leaves our control: it gets emailed around, hand-edited,
// and re-uploaded. So the import side treats the document as hostile input and
// validates it in full BEFORE touching the database, rather than discovering a
// bad slide halfway through a write and leaving a half-built deck behind.

import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { VALID_SLIDE_TYPES, configIssues } from "../slides/registry.js";
import { clampTimeScale, DEFAULT_TIME_SCALE } from "../timeScale.js";

export const transferRouter = Router();

transferRouter.use(requireAuth);

/** Bumped only on a breaking change to the document shape. */
const FORMAT_VERSION = 1;

// Caps. These exist to bound what one upload can cost us — a deck row, the
// create-session payload that carries every slide, and the editor that has to
// render the result.
const MAX_SLIDES = 200;
const MAX_TITLE = 200;
const MAX_QUESTION = 500;
const MAX_NOTES = 4000;
const MAX_CONFIG_BYTES = 20 * 1024;
/** Longest filename stem we'll derive from a title. */
const MAX_FILENAME = 60;

const VALID_PACING = ["PRESENTER", "AUDIENCE"];
const VALID_FILTER_MODES = ["off", "mask", "block"];

interface DeckSlide {
  order: number;
  type: string;
  question: string;
  config: unknown;
  notes: string;
}

interface DeckDoc {
  formatVersion: number;
  title: string;
  theme: string;
  pacing: string;
  filterMode: string;
  /**
   * The relaxed-timing accommodation (DESIGN.md §6) — a deck-level multiplier
   * on every countdown. Added after the format shipped, so OLDER FILES DO NOT
   * HAVE IT and the import side falls back to the default rather than
   * refusing. `formatVersion` is deliberately NOT bumped: an optional field is
   * compatible in both directions. An old server reading a new file ignores an
   * unknown key (validateDeck never enumerated the envelope), and this server
   * reading an old file defaults it — so bumping would have broken every
   * exchange that currently works in order to describe a change that breaks
   * none of them.
   */
  timeScale: number;
  slides: DeckSlide[];
}

/** A validated deck, ready to write: config is already a JSON string. */
interface ImportDeck {
  title: string;
  theme: string;
  pacing: string;
  filterMode: string;
  timeScale: number;
  slides: { order: number; type: string; question: string; config: string; notes: string }[];
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * A title is user-authored text going into a Content-Disposition header, which
 * is a quoted string: a quote, a newline or a path separator in there is
 * header injection or path traversal on the downloader's disk. Keep an
 * explicit safe set rather than blocking a list of bad characters.
 */
function filenameFor(title: string): string {
  const stem = title
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_FILENAME)
    .replace(/-+$/, "");
  return `${stem || "deck"}.json`;
}

// ---- Export ----

transferRouter.get("/:id/export", async (req: AuthedRequest, res) => {
  const deck = await prisma.presentation.findFirst({
    where: { id: req.params.id, ownerId: req.auth!.userId },
    // Soft-deleted slides are tombstones kept for session history
    // (schema.prisma, Slide.deletedAt), not part of the deck — an export that
    // carried them would resurrect every slide the host ever removed on the
    // next import.
    include: { slides: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!deck) return res.status(404).json({ error: "Not found" });

  const doc: DeckDoc = {
    formatVersion: FORMAT_VERSION,
    title: deck.title,
    theme: deck.theme,
    pacing: deck.pacing,
    filterMode: deck.filterMode,
    // Clamped on the way OUT as well as in, so a row that predates the bounds
    // cannot put an out-of-range value into a file other people will import.
    timeScale: clampTimeScale(deck.timeScale),
    // config is parsed, not passed through as a string: the file should be
    // readable and hand-editable, and a double-encoded blob is neither.
    slides: deck.slides.map((s) => ({
      order: s.order,
      type: s.type,
      question: s.question,
      config: safeParse(s.config),
      notes: s.notes,
    })),
  };

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameFor(deck.title)}"`);
  res.send(JSON.stringify(doc, null, 2));
});

// ---- Import ----

type Validation =
  | { ok: true; deck: ImportDeck }
  | { ok: false; error: string; rejectedTypes?: string[]; slideErrors?: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reject a config carrying a `__proto__` key before it is ever re-parsed. */
function hasUnsafeKey(value: unknown, depth = 0): boolean {
  if (depth > 20 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => hasUnsafeKey(v, depth + 1));
  for (const [k, v] of Object.entries(value)) {
    if (k === "__proto__") return true;
    if (hasUnsafeKey(v, depth + 1)) return true;
  }
  return false;
}

/**
 * Whole-document validation. Returns the normalised deck or the first
 * violation; nothing here writes, so a rejected document costs one parse.
 */
function validateDeck(raw: unknown): Validation {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "The file does not contain a deck object." };
  }
  if (raw.formatVersion !== FORMAT_VERSION) {
    return {
      ok: false,
      error:
        raw.formatVersion === undefined
          ? "This file has no formatVersion, so it isn't a deck export."
          : `Unsupported formatVersion ${JSON.stringify(raw.formatVersion)} — this server reads version ${FORMAT_VERSION}.`,
    };
  }

  const title = raw.title === undefined ? "Imported deck" : raw.title;
  if (typeof title !== "string") return { ok: false, error: "title must be text." };
  if (title.length > MAX_TITLE) {
    return { ok: false, error: `title is longer than ${MAX_TITLE} characters.` };
  }

  const theme = raw.theme === undefined ? "floodlight" : raw.theme;
  if (typeof theme !== "string" || theme.length > 64) {
    return { ok: false, error: "theme must be a short text key." };
  }

  const pacing = raw.pacing === undefined ? "PRESENTER" : raw.pacing;
  if (typeof pacing !== "string" || !VALID_PACING.includes(pacing)) {
    return { ok: false, error: `pacing must be one of ${VALID_PACING.join(", ")}.` };
  }

  const filterMode = raw.filterMode === undefined ? "mask" : raw.filterMode;
  if (typeof filterMode !== "string" || !VALID_FILTER_MODES.includes(filterMode)) {
    return { ok: false, error: `filterMode must be one of ${VALID_FILTER_MODES.join(", ")}.` };
  }

  // Absent on every file exported before this field existed, which is the
  // common case and must not be a refusal — fall back to the same default the
  // database column has. Present but not a number IS a refusal, in keeping
  // with the rest of the envelope: silently rewriting a timing accommodation
  // to 1 is the exact failure this field was added to stop.
  let timeScale = DEFAULT_TIME_SCALE;
  if (raw.timeScale !== undefined) {
    if (typeof raw.timeScale !== "number" || !Number.isFinite(raw.timeScale)) {
      return { ok: false, error: "timeScale must be a number." };
    }
    timeScale = clampTimeScale(raw.timeScale);
  }

  const rawSlides = raw.slides === undefined ? [] : raw.slides;
  if (!Array.isArray(rawSlides)) return { ok: false, error: "slides must be a list." };
  // A deck with nothing in it is not importable, it is just deferred: the
  // session handler refuses to start one (`EMPTY_DECK`, sockets/session.ts),
  // so the 200 here only moves the failure to the moment the host presses
  // Present with a room already in front of them. Every other check in this
  // function exists to pull a failure back to the upload; this is the same
  // rule applied to the whole file rather than to one slide.
  if (rawSlides.length === 0) {
    return {
      ok: false,
      error:
        "This deck has no slides, so there is nothing to present — a session cannot be started from it. Add at least one slide to the file.",
    };
  }
  if (rawSlides.length > MAX_SLIDES) {
    return {
      ok: false,
      error: `This deck has ${rawSlides.length} slides; the limit is ${MAX_SLIDES}.`,
    };
  }

  // Collect every unknown type in one pass rather than failing on the first,
  // so the host is told the whole story instead of fixing one and retrying.
  const rejectedTypes: string[] = [];
  for (const entry of rawSlides) {
    if (!isPlainObject(entry)) continue;
    const t = entry.type;
    if (typeof t !== "string" || !VALID_SLIDE_TYPES.includes(t)) {
      const label = typeof t === "string" && t ? t : "(missing)";
      if (!rejectedTypes.includes(label)) rejectedTypes.push(label);
    }
  }
  if (rejectedTypes.length > 0) {
    // Importing the rest and silently dropping these would hand back a deck
    // that quietly lost slides — worse than a refusal the host can act on.
    return {
      ok: false,
      error: "This deck uses slide types this server doesn't recognise.",
      rejectedTypes,
    };
  }

  const slides: ImportDeck["slides"] = [];
  /** Per-slide config faults, collected across the whole file. */
  const configProblems: string[] = [];
  for (let i = 0; i < rawSlides.length; i++) {
    const entry = rawSlides[i];
    const at = `Slide ${i + 1}`;
    if (!isPlainObject(entry)) return { ok: false, error: `${at} is not an object.` };

    const question = entry.question === undefined ? "" : entry.question;
    if (typeof question !== "string") return { ok: false, error: `${at}: question must be text.` };
    if (question.length > MAX_QUESTION) {
      return { ok: false, error: `${at}: question is longer than ${MAX_QUESTION} characters.` };
    }

    const notes = entry.notes === undefined ? "" : entry.notes;
    if (typeof notes !== "string") return { ok: false, error: `${at}: notes must be text.` };
    if (notes.length > MAX_NOTES) {
      return { ok: false, error: `${at}: notes are longer than ${MAX_NOTES} characters.` };
    }

    const config = entry.config === undefined ? {} : entry.config;
    if (!isPlainObject(config)) {
      return { ok: false, error: `${at}: config must be a JSON object.` };
    }
    if (hasUnsafeKey(config)) {
      return { ok: false, error: `${at}: config contains a reserved key.` };
    }
    // Re-serialise here rather than trusting any string the client sent, and
    // measure the result — the stored column is what has to stay bounded.
    let serialised: string;
    try {
      serialised = JSON.stringify(config);
    } catch {
      return { ok: false, error: `${at}: config could not be serialised.` };
    }
    if (Buffer.byteLength(serialised, "utf8") > MAX_CONFIG_BYTES) {
      return {
        ok: false,
        error: `${at}: config is larger than ${Math.round(MAX_CONFIG_BYTES / 1024)}KB.`,
      };
    }

    // Ask the slide's own module whether this config is playable. Everything
    // above this line is the ENVELOPE — version, types, lengths, byte sizes —
    // and for a long time it was the whole of the import check: a deck whose
    // answer key pointed past the end of its option list, whose scale had no
    // steps, or whose quiz had no answer at all imported with a 200 and failed
    // in front of a room.
    //
    // A deck FILE is a finished artifact, not a slide someone is still
    // writing, so BOTH kinds of issue are refused here — an unfilled required
    // field in an uploaded deck is not "not yet", it is "never". (The editor's
    // save path cannot take that line; see presentations.ts.)
    for (const issue of configIssues(entry.type as string, config)) {
      configProblems.push(`${at} (${entry.type}): ${issue.message}`);
    }

    // Order comes from position in the file, not from the file's own `order`
    // field, which can be duplicated, negative or sparse.
    slides.push({ order: i, type: entry.type as string, question, config: serialised, notes });
  }

  // Reported together, like the unknown-type pass above: a host fixing one
  // broken slide per upload is the experience this whole function exists to
  // avoid.
  if (configProblems.length > 0) {
    return {
      ok: false,
      error:
        configProblems.length === 1
          ? "One slide in this deck is not playable as configured."
          : `${configProblems.length} problems in this deck would make slides unplayable.`,
      slideErrors: configProblems,
    };
  }

  return {
    ok: true,
    deck: { title: title.trim() || "Imported deck", theme, pacing, filterMode, timeScale, slides },
  };
}

transferRouter.post("/import", async (req: AuthedRequest, res) => {
  const result = validateDeck(req.body?.deck);
  if (!result.ok) {
    return res.status(400).json({
      error: result.error,
      ...(result.rejectedTypes ? { rejectedTypes: result.rejectedTypes } : {}),
      // One line per broken slide, already prefixed with which slide it is.
      ...(result.slideErrors ? { slideErrors: result.slideErrors } : {}),
    });
  }

  const { deck } = result;
  // One nested create, so the deck and its slides land together or not at all.
  const created = await prisma.presentation.create({
    data: {
      ownerId: req.auth!.userId,
      title: deck.title,
      theme: deck.theme,
      pacing: deck.pacing,
      filterMode: deck.filterMode,
      timeScale: deck.timeScale,
      // An import is a deck of your own, never a template — publishing is a
      // separate, deliberate act.
      isTemplate: false,
      slides: {
        create: deck.slides.map((s) => ({
          order: s.order,
          type: s.type,
          question: s.question,
          config: s.config,
          notes: s.notes,
        })),
      },
    },
    // Matches every other deck-card count: live slides only.
    include: { _count: { select: { slides: { where: { deletedAt: null } } } } },
  });

  res.json(created);
});
