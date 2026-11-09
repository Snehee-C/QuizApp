#!/usr/bin/env node
// validate-deck.mjs — check a deck JSON file before it is imported.
//
//   node validate-deck.mjs my-deck.json
//
// Exit 0 = safe to import. Exit 1 = at least one ERROR.
//
// Two classes of finding:
//
//   ERROR   The importer will refuse the file, OR the slide will import and
//           then be broken/unplayable (a quiz that can never score, a pin
//           slide with no image, options a player cannot pick).
//   WARN    Imports and works, but is probably not what the author meant
//           (an unknown theme that silently falls back, a config key the app
//           never reads — usually a typo).
//
// Stock Node, no dependencies.

import fs from "node:fs";

/* ───────────────────────── The envelope contract ─────────────────────────
   Mirrors server/src/routes/transfer.ts validateDeck(). Keep in sync. */

const FORMAT_VERSION = 1;
const MAX_SLIDES = 200;
const MAX_TITLE = 200;
const MAX_QUESTION = 500;
const MAX_NOTES = 4000;
const MAX_CONFIG_BYTES = 20 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024; // express.json({ limit: "2mb" })

const VALID_PACING = ["PRESENTER", "AUDIENCE"];
const VALID_FILTER_MODES = ["off", "mask", "block"];
const KNOWN_THEMES = ["floodlight", "ember", "tide", "paper"];

// server/src/slides/types.ts
const MIN_TIME_LIMIT_SEC = 5;
const MAX_TIME_LIMIT_SEC = 600;

// server/src/slides/registry.ts — VALID_SLIDE_TYPES, in registry order.
const VALID_SLIDE_TYPES = [
  "MULTIPLE_CHOICE",
  "WORD_CLOUD",
  "SCALE",
  "OPEN_ENDED",
  "RANKING",
  "HUNDRED_POINTS",
  "GRID_2X2",
  "PIN_ON_IMAGE",
  "GUESS_NUMBER",
  "TYPE_ANSWER",
  "CONTENT_HEADING",
  "CONTENT_BULLETS",
  "CONTENT_QUOTE",
  "CONTENT_BIG_NUMBER",
  "CONTENT_IMAGE",
  "CONTENT_INSTRUCTIONS",
  "SPIN_WHEEL",
];

/** Types that are never scored and never run a countdown. */
const NON_INTERACTIVE = new Set([
  "CONTENT_HEADING",
  "CONTENT_BULLETS",
  "CONTENT_QUOTE",
  "CONTENT_BIG_NUMBER",
  "CONTENT_IMAGE",
  "CONTENT_INSTRUCTIONS",
  "SPIN_WHEEL",
]);

/** The only three types with a grade() on the server. */
const QUIZ_CAPABLE = new Set(["MULTIPLE_CHOICE", "GUESS_NUMBER", "TYPE_ANSWER"]);

/** Every config key the app reads, per type. Anything else is dead weight. */
const KNOWN_KEYS = {
  MULTIPLE_CHOICE: ["options", "allowMultiple", "isQuiz", "correctIndices", "correctIndex", "timeLimitSec"],
  WORD_CLOUD: ["maxWords"],
  SCALE: ["scaleMin", "scaleMax"],
  OPEN_ENDED: [],
  RANKING: ["items"],
  HUNDRED_POINTS: ["options", "total"],
  GRID_2X2: ["xLabelLow", "xLabelHigh", "yLabelLow", "yLabelHigh"],
  PIN_ON_IMAGE: ["imageUrl", "caption"],
  GUESS_NUMBER: ["correctValue", "tolerance", "unit", "isQuiz", "timeLimitSec"],
  TYPE_ANSWER: ["acceptedAnswers", "caseSensitive", "isQuiz", "timeLimitSec"],
  CONTENT_HEADING: ["subtitle"],
  CONTENT_BULLETS: ["bullets"],
  CONTENT_QUOTE: ["attribution"],
  CONTENT_BIG_NUMBER: ["value", "caption"],
  CONTENT_IMAGE: ["imageUrl", "caption"],
  CONTENT_INSTRUCTIONS: [],
  SPIN_WHEEL: ["entries"],
};

/** Answer-key keys. On a type that cannot score, their presence is a mismodel. */
const ANSWER_KEYS = ["correctIndices", "correctIndex", "acceptedAnswers", "correctValue", "tolerance"];

const ENVELOPE_KEYS = ["formatVersion", "title", "theme", "pacing", "filterMode", "slides"];
const SLIDE_KEYS = ["order", "type", "question", "config", "notes"];

/* ───────────────────────────── Findings ───────────────────────────── */

const findings = [];
const err = (where, msg) => findings.push({ sev: "ERROR", where, msg });
const warn = (where, msg) => findings.push({ sev: "WARN", where, msg });

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);
const quote = (v) => JSON.stringify(v);

/** Matches the importer's own __proto__ scan (transfer.ts hasUnsafeKey). */
function hasUnsafeKey(value, depth = 0) {
  if (depth > 20 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => hasUnsafeKey(v, depth + 1));
  for (const [k, v] of Object.entries(value)) {
    if (k === "__proto__") return true;
    if (hasUnsafeKey(v, depth + 1)) return true;
  }
  return false;
}

/** A non-empty string list, e.g. options / items / entries / bullets. */
function checkStringList(where, cfg, key, { min, softMax, required = true, label = key }) {
  const v = cfg[key];
  if (v === undefined) {
    if (required) err(where, `config.${key} is missing. ${label} is what the slide renders — without it the slide is blank.`);
    return null;
  }
  if (!Array.isArray(v)) {
    err(where, `config.${key} must be an array of strings, got ${typeOf(v)}.`);
    return null;
  }
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string") {
      err(where, `config.${key}[${i}] must be a string, got ${typeOf(v[i])}.`);
      return null;
    }
    if (v[i].trim() === "") {
      err(where, `config.${key}[${i}] is empty. A blank ${label.replace(/s$/, "")} renders as an empty slot the room cannot read.`);
    }
  }
  if (min !== undefined && v.length < min) {
    err(where, `config.${key} has ${v.length} entr${v.length === 1 ? "y" : "ies"}; this type needs at least ${min}.`);
  }
  if (softMax !== undefined && v.length > softMax) {
    warn(where, `config.${key} has ${v.length} entries; the editor caps this type at ${softMax}. It will import, but the stage is designed for ${softMax}.`);
  }
  return v;
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}

function checkOptionalString(where, cfg, key) {
  if (cfg[key] !== undefined && typeof cfg[key] !== "string") {
    err(where, `config.${key} must be a string, got ${typeOf(cfg[key])}.`);
  }
}

function checkOptionalBool(where, cfg, key) {
  if (cfg[key] !== undefined && typeof cfg[key] !== "boolean") {
    err(where, `config.${key} must be true or false, got ${quote(cfg[key])}.`);
  }
}

function checkTimeLimit(where, cfg) {
  if (cfg.timeLimitSec === undefined) return;
  if (!isFiniteNum(cfg.timeLimitSec)) {
    err(where, `config.timeLimitSec must be a number of seconds, got ${quote(cfg.timeLimitSec)}.`);
    return;
  }
  if (cfg.timeLimitSec < MIN_TIME_LIMIT_SEC || cfg.timeLimitSec > MAX_TIME_LIMIT_SEC) {
    err(
      where,
      `config.timeLimitSec is ${cfg.timeLimitSec}; the server clamps every countdown to ${MIN_TIME_LIMIT_SEC}-${MAX_TIME_LIMIT_SEC} seconds, so this value is silently rewritten at run time. Write the value you actually want.`
    );
  }
}

/**
 * isQuiz is the switch for BOTH scoring and the countdown. An answer key with
 * isQuiz off is the single most common way to ship a "quiz" that scores zero.
 */
function checkQuizSwitch(where, type, cfg, hasKey) {
  checkOptionalBool(where, cfg, "isQuiz");
  const on = cfg.isQuiz === true;
  if (hasKey && !on) {
    err(
      where,
      `an answer key is set but config.isQuiz is ${cfg.isQuiz === undefined ? "missing" : quote(cfg.isQuiz)}. ${type} only scores — and only runs a countdown — when isQuiz is exactly true. As written this slide awards 0 points to everyone. Set "isQuiz": true, or drop the answer key if the slide is meant to be an unscored poll.`
    );
  }
  if (on && !hasKey) {
    err(where, `config.isQuiz is true but there is no answer key, so nothing can ever be marked correct.`);
  }
  return on;
}

/* ───────────────────────── Per-type rules ───────────────────────── */

const RULES = {
  MULTIPLE_CHOICE(where, cfg) {
    const options = checkStringList(where, cfg, "options", { min: 2, softMax: 6, label: "options" });
    checkOptionalBool(where, cfg, "allowMultiple");
    checkTimeLimit(where, cfg);

    let key = null;
    if (cfg.correctIndices !== undefined) {
      if (!Array.isArray(cfg.correctIndices)) {
        err(where, `config.correctIndices must be an array of option INDEXES (0 = the first option), got ${typeOf(cfg.correctIndices)}. It is never the answer text.`);
      } else {
        key = cfg.correctIndices;
      }
    } else if (cfg.correctIndex !== undefined) {
      if (!isInt(cfg.correctIndex)) err(where, `config.correctIndex must be a whole number index, got ${quote(cfg.correctIndex)}.`);
      else key = [cfg.correctIndex];
    }

    if (key) {
      const n = Array.isArray(options) ? options.length : null;
      const seen = new Set();
      for (const k of key) {
        if (typeof k === "string") {
          err(where, `config.correctIndices contains ${quote(k)}. It must hold option INDEXES, not answer text — index 0 is ${options ? quote(options[0]) : "the first option"}.`);
          continue;
        }
        if (!isInt(k) || k < 0) {
          err(where, `config.correctIndices contains ${quote(k)}; every entry must be a whole number 0 or greater.`);
          continue;
        }
        if (n !== null && k >= n) {
          err(where, `config.correctIndices ${JSON.stringify(key)} is out of range for ${n} option${n === 1 ? "" : "s"} (valid indexes are 0-${n - 1}; indexes are 0-based, so the last option is ${n - 1}, not ${n}).`);
          continue;
        }
        if (seen.has(k)) err(where, `config.correctIndices lists index ${k} twice.`);
        seen.add(k);
      }
      if (key.length === 0 && cfg.isQuiz === true) {
        err(where, `config.correctIndices is empty but isQuiz is true, so no answer can ever be correct.`);
      }
      if (key.length > 1 && cfg.allowMultiple !== true) {
        err(
          where,
          `config.correctIndices has ${key.length} correct answers but allowMultiple is ${cfg.allowMultiple === undefined ? "missing" : quote(cfg.allowMultiple)}. Players can only pick one option, and grading requires the pick set to equal the key exactly — so this question is unwinnable. Set "allowMultiple": true, or keep one correct index.`
        );
      }
    }
    checkQuizSwitch(where, "MULTIPLE_CHOICE", cfg, key !== null && key.length > 0);
  },

  WORD_CLOUD(where, cfg) {
    if (cfg.maxWords === undefined) return;
    if (!isInt(cfg.maxWords) || cfg.maxWords < 1) {
      err(where, `config.maxWords must be a whole number of 1 or more, got ${quote(cfg.maxWords)}. Below 1 every submission is rejected.`);
    } else if (cfg.maxWords > 6) {
      warn(where, `config.maxWords is ${cfg.maxWords}; the editor caps it at 6.`);
    }
  },

  SCALE(where, cfg) {
    const min = cfg.scaleMin === undefined ? 1 : cfg.scaleMin;
    const max = cfg.scaleMax === undefined ? 5 : cfg.scaleMax;
    if (!isInt(min)) err(where, `config.scaleMin must be a whole number, got ${quote(cfg.scaleMin)}.`);
    if (!isInt(max)) err(where, `config.scaleMax must be a whole number, got ${quote(cfg.scaleMax)}.`);
    if (isInt(min) && isInt(max)) {
      if (max <= min) err(where, `config.scaleMax (${max}) must be greater than config.scaleMin (${min}); otherwise the player sees no buttons to tap.`);
      else if (max - min + 1 > 10) warn(where, `the scale has ${max - min + 1} steps; the player renders one button per step, so anything past about 10 gets hard to tap.`);
    }
  },

  OPEN_ENDED() {},

  RANKING(where, cfg) {
    checkStringList(where, cfg, "items", { min: 2, softMax: 6, label: "items" });
  },

  HUNDRED_POINTS(where, cfg) {
    checkStringList(where, cfg, "options", { min: 2, softMax: 6, label: "options" });
    if (cfg.total !== undefined) {
      if (!isInt(cfg.total) || cfg.total <= 0) {
        err(where, `config.total must be a whole number above 0, got ${quote(cfg.total)}. It is the budget every player must spend exactly.`);
      } else if (cfg.total > 1000) {
        warn(where, `config.total is ${cfg.total}; a budget that large is tedious to allocate on a phone. 100 is the default.`);
      }
    }
  },

  GRID_2X2(where, cfg) {
    for (const k of ["xLabelLow", "xLabelHigh", "yLabelLow", "yLabelHigh"]) checkOptionalString(where, cfg, k);
  },

  PIN_ON_IMAGE(where, cfg) {
    checkOptionalString(where, cfg, "caption");
    const url = cfg.imageUrl;
    if (typeof url !== "string" || url.trim() === "") {
      err(where, `config.imageUrl is required for PIN_ON_IMAGE — there is nothing to pin on without it.`);
      return;
    }
    if (!/^https?:\/\//i.test(url.trim()) && !/^data:image\//i.test(url.trim()) && !url.trim().startsWith("/")) {
      err(where, `config.imageUrl ${quote(url)} will not render: this slide only accepts http(s)://…, data:image/… or a same-origin path starting with "/".`);
    }
  },

  GUESS_NUMBER(where, cfg) {
    checkOptionalString(where, cfg, "unit");
    checkTimeLimit(where, cfg);
    let hasKey = false;
    if (cfg.correctValue === undefined) {
      err(where, `config.correctValue is required — it is the number being guessed.`);
    } else if (!isFiniteNum(cfg.correctValue)) {
      err(where, `config.correctValue must be a finite number, got ${quote(cfg.correctValue)}.`);
    } else {
      hasKey = true;
    }
    if (cfg.tolerance !== undefined) {
      if (!isFiniteNum(cfg.tolerance)) err(where, `config.tolerance must be a number, got ${quote(cfg.tolerance)}.`);
      else if (cfg.tolerance < 0) warn(where, `config.tolerance is negative; the server takes its absolute value, so this behaves as ${Math.abs(cfg.tolerance)}.`);
    }
    checkQuizSwitch(where, "GUESS_NUMBER", cfg, hasKey);
  },

  TYPE_ANSWER(where, cfg) {
    checkOptionalBool(where, cfg, "caseSensitive");
    checkTimeLimit(where, cfg);
    const list = cfg.acceptedAnswers;
    let hasKey = false;
    if (list === undefined) {
      err(where, `config.acceptedAnswers is required — it is the entire answer key for TYPE_ANSWER.`);
    } else if (!Array.isArray(list)) {
      err(where, `config.acceptedAnswers must be an array of strings, got ${typeOf(list)}.`);
    } else {
      const live = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (typeof a !== "string") {
          err(where, `config.acceptedAnswers[${i}] must be a string, got ${typeOf(a)}.`);
          continue;
        }
        const norm = a.trim().replace(/\s+/g, " ");
        if (norm === "") {
          warn(where, `config.acceptedAnswers[${i}] is blank; the server drops blank entries.`);
          continue;
        }
        if (norm.length > 120) {
          err(where, `config.acceptedAnswers[${i}] is ${norm.length} characters; the player's input stops at 120, so this answer can never be typed.`);
        }
        const cmp = cfg.caseSensitive === true ? norm : norm.toLocaleLowerCase();
        if (live.includes(cmp)) warn(where, `config.acceptedAnswers[${i}] (${quote(a)}) duplicates an earlier entry once trimmed${cfg.caseSensitive === true ? "" : " and case-folded"}.`);
        live.push(cmp);
      }
      if (live.length === 0) err(where, `config.acceptedAnswers has no usable answer, so nothing can ever be marked correct.`);
      else hasKey = true;
    }
    checkQuizSwitch(where, "TYPE_ANSWER", cfg, hasKey);
  },

  CONTENT_HEADING(where, cfg, slide) {
    checkOptionalString(where, cfg, "subtitle");
    requireQuestion(where, slide, "the heading text");
  },

  CONTENT_BULLETS(where, cfg, slide) {
    const b = checkStringList(where, cfg, "bullets", { min: 1, softMax: 6, label: "bullets" });
    if (b && b.length === 0) err(where, `config.bullets is empty; the slide would show a heading over nothing.`);
    requireQuestion(where, slide, "the heading above the bullets");
  },

  CONTENT_QUOTE(where, cfg, slide) {
    checkOptionalString(where, cfg, "attribution");
    requireQuestion(where, slide, "the quote itself");
  },

  CONTENT_BIG_NUMBER(where, cfg) {
    checkOptionalString(where, cfg, "caption");
    if (typeof cfg.value !== "string" || cfg.value.trim() === "") {
      err(where, `config.value is required for CONTENT_BIG_NUMBER and must be a STRING (e.g. "72%", "1.4bn") — it is the figure filling the screen.`);
    }
  },

  CONTENT_IMAGE(where, cfg) {
    checkOptionalString(where, cfg, "caption");
    const url = cfg.imageUrl;
    if (typeof url !== "string" || url.trim() === "") {
      err(where, `config.imageUrl is required for CONTENT_IMAGE — the slide is otherwise blank.`);
      return;
    }
    if (!/^(https?:|data:image\/|blob:|\/\/|\/|\.)/i.test(url.trim())) {
      err(where, `config.imageUrl ${quote(url)} will not render: it must start with http(s):, data:image/, // or /.`);
    }
  },

  CONTENT_INSTRUCTIONS(where, cfg, slide) {
    requireQuestion(where, slide, "the heading (e.g. \"How to join\")");
    if (Object.keys(cfg).length > 0) {
      warn(where, `CONTENT_INSTRUCTIONS takes no config — the join code belongs to the live session, not the slide. Extra keys are ignored.`);
    }
  },

  SPIN_WHEEL(where, cfg, slide) {
    checkStringList(where, cfg, "entries", { min: 2, softMax: 12, label: "entries" });
    requireQuestion(where, slide, "the wheel's title");
  },
};

/** Types whose only visible text is `question`, which the stage draws itself. */
function requireQuestion(where, slide, what) {
  if (typeof slide.question !== "string" || slide.question.trim() === "") {
    err(where, `question is empty, but on this type it carries ${what}. The slide would render blank.`);
  }
}

/* ───────────────────────────── Main ───────────────────────────── */

function validateDeck(doc, rawBytes) {
  if (!isPlainObject(doc)) {
    err("file", `the top level must be a deck object, got ${typeOf(doc)}. The file content IS the deck — do not wrap it in {"deck": …}.`);
    return;
  }

  if (rawBytes > MAX_REQUEST_BYTES) {
    err("file", `the file is ${(rawBytes / 1024 / 1024).toFixed(2)}MB; the API refuses a request body over 2MB.`);
  }

  if (doc.formatVersion !== FORMAT_VERSION) {
    err(
      "envelope",
      doc.formatVersion === undefined
        ? `formatVersion is missing. The importer refuses the file outright: add "formatVersion": ${FORMAT_VERSION}.`
        : `formatVersion is ${quote(doc.formatVersion)}; this server reads version ${FORMAT_VERSION} only (and compares with ===, so the string "1" is rejected).`
    );
  }

  if (doc.title !== undefined) {
    if (typeof doc.title !== "string") err("envelope", `title must be text, got ${typeOf(doc.title)}.`);
    else if (doc.title.length > MAX_TITLE) err("envelope", `title is ${doc.title.length} characters; the limit is ${MAX_TITLE}.`);
    else if (doc.title.trim() === "") warn("envelope", `title is blank; the deck will be named "Imported deck".`);
  } else {
    warn("envelope", `title is missing; the deck will be named "Imported deck".`);
  }

  if (doc.theme !== undefined) {
    if (typeof doc.theme !== "string" || doc.theme.length > 64) {
      err("envelope", `theme must be a short text key, got ${quote(doc.theme)}.`);
    } else if (!KNOWN_THEMES.includes(doc.theme)) {
      warn("envelope", `theme ${quote(doc.theme)} is not one of ${KNOWN_THEMES.join(", ")}; the app silently falls back to floodlight.`);
    }
  }

  if (doc.pacing !== undefined && !VALID_PACING.includes(doc.pacing)) {
    err("envelope", `pacing must be exactly one of ${VALID_PACING.join(" or ")} (upper case), got ${quote(doc.pacing)}.`);
  }
  if (doc.filterMode !== undefined && !VALID_FILTER_MODES.includes(doc.filterMode)) {
    err("envelope", `filterMode must be one of ${VALID_FILTER_MODES.join(", ")} (lower case), got ${quote(doc.filterMode)}.`);
  }

  for (const k of Object.keys(doc)) {
    if (!ENVELOPE_KEYS.includes(k)) {
      warn("envelope", `unknown top-level key ${quote(k)} — the importer ignores it (the envelope is: ${ENVELOPE_KEYS.join(", ")}).`);
    }
  }

  const slides = doc.slides;
  if (slides === undefined) {
    warn("envelope", `slides is missing; this imports an empty deck.`);
    return;
  }
  if (!Array.isArray(slides)) {
    err("envelope", `slides must be a list, got ${typeOf(slides)}.`);
    return;
  }
  if (slides.length === 0) warn("envelope", `slides is empty; this imports a deck with nothing in it.`);
  if (slides.length > MAX_SLIDES) err("envelope", `the deck has ${slides.length} slides; the limit is ${MAX_SLIDES}.`);

  slides.forEach((slide, i) => validateSlide(slide, i));
}

function validateSlide(slide, i) {
  const n = i + 1;
  if (!isPlainObject(slide)) {
    err(`slide ${n}`, `must be an object, got ${typeOf(slide)}.`);
    return;
  }

  const type = slide.type;
  const typeOk = typeof type === "string" && VALID_SLIDE_TYPES.includes(type);
  const where = `slide ${n}${typeOk ? ` (${type})` : ""}`;

  if (!typeOk) {
    err(
      `slide ${n}`,
      `type ${type === undefined ? "is missing" : `is ${quote(type)}, which this server does not recognise`}. The importer refuses the WHOLE file on an unknown type rather than dropping the slide. Valid types: ${VALID_SLIDE_TYPES.join(", ")}.`
    );
    return;
  }

  if (slide.question !== undefined && typeof slide.question !== "string") {
    err(where, `question must be text, got ${typeOf(slide.question)}.`);
  } else if (typeof slide.question === "string" && slide.question.length > MAX_QUESTION) {
    err(where, `question is ${slide.question.length} characters; the limit is ${MAX_QUESTION}.`);
  }

  if (slide.notes !== undefined && typeof slide.notes !== "string") {
    err(where, `notes must be text, got ${typeOf(slide.notes)}.`);
  } else if (typeof slide.notes === "string" && slide.notes.length > MAX_NOTES) {
    err(where, `notes are ${slide.notes.length} characters; the limit is ${MAX_NOTES}.`);
  }

  if (slide.order !== undefined) {
    if (!isFiniteNum(slide.order)) warn(where, `order should be a number; the importer ignores it either way.`);
    else if (slide.order !== i) warn(where, `order is ${slide.order} but this slide sits at position ${i} in the array. The importer uses ARRAY POSITION and overwrites order, so the deck will not come out in the order this field implies.`);
  }

  const cfg = slide.config === undefined ? {} : slide.config;
  if (slide.config !== undefined && !isPlainObject(cfg)) {
    err(where, `config must be a JSON object, got ${typeOf(slide.config)}. It is a real nested object in the file — never a pre-stringified JSON blob; the server stringifies it on import.`);
    return;
  }
  if (hasUnsafeKey(cfg)) {
    err(where, `config contains a reserved "__proto__" key; the importer refuses the file.`);
    return;
  }
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(cfg), "utf8");
  } catch {
    err(where, `config could not be serialised (circular reference?).`);
    return;
  }
  if (bytes > MAX_CONFIG_BYTES) {
    err(where, `config is ${(bytes / 1024).toFixed(1)}KB; the limit is ${MAX_CONFIG_BYTES / 1024}KB per slide. A large inline data: image is the usual cause — host the image and use a URL.`);
  }

  // Reported specifically further down, so skip the generic "unknown key" line.
  const COVERED_ELSEWHERE = ["isQuiz", "timeLimitSec"];

  for (const k of Object.keys(cfg)) {
    if (!KNOWN_KEYS[type].includes(k) && !COVERED_ELSEWHERE.includes(k)) {
      const hint = ANSWER_KEYS.includes(k) && !QUIZ_CAPABLE.has(type)
        ? ` ${type} has no grade() on the server — only MULTIPLE_CHOICE, GUESS_NUMBER and TYPE_ANSWER can score. If you meant to ask a scored question, change the slide type.`
        : ` ${type} reads: ${KNOWN_KEYS[type].length ? KNOWN_KEYS[type].join(", ") : "(no config at all)"}.`;
      if (ANSWER_KEYS.includes(k) && !QUIZ_CAPABLE.has(type)) err(where, `config.${k} is an answer key on a type that can never score.${hint}`);
      else warn(where, `config.${k} is not read by this slide type — likely a typo.${hint}`);
    }
  }

  if (NON_INTERACTIVE.has(type)) {
    if (cfg.timeLimitSec !== undefined) {
      err(where, `config.timeLimitSec is set on a non-interactive slide. ${type} takes no answers and never runs a countdown, so the presenter advances it by hand.`);
    }
    if (cfg.isQuiz !== undefined) {
      err(where, `config.isQuiz is set on a non-interactive slide. ${type} takes no answers at all, so it can never be scored — if you meant a scored question, use MULTIPLE_CHOICE, GUESS_NUMBER or TYPE_ANSWER.`);
    }
  }
  if (type === "WORD_CLOUD" || type === "SCALE" || type === "OPEN_ENDED" || type === "RANKING" || type === "HUNDRED_POINTS" || type === "GRID_2X2" || type === "PIN_ON_IMAGE") {
    if (cfg.timeLimitSec !== undefined) warn(where, `config.timeLimitSec is ignored: only MULTIPLE_CHOICE, GUESS_NUMBER and TYPE_ANSWER run a countdown, and only when isQuiz is true.`);
    if (cfg.isQuiz !== undefined) warn(where, `config.isQuiz is ignored: ${type} has no grade() on the server and can never score.`);
  }

  RULES[type](where, cfg, slide);
}

/* ───────────────────────────── CLI ───────────────────────────── */

const file = process.argv[2];
if (!file) {
  console.error("usage: node validate-deck.mjs <deck.json>");
  process.exit(2);
}

let raw;
try {
  raw = fs.readFileSync(file, "utf8");
} catch (e) {
  console.error(`Cannot read ${file}: ${e.message}`);
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(raw);
} catch (e) {
  console.error(`${file} is not valid JSON: ${e.message}`);
  process.exit(1);
}

validateDeck(doc, Buffer.byteLength(raw, "utf8"));

const errors = findings.filter((f) => f.sev === "ERROR");
const warns = findings.filter((f) => f.sev === "WARN");

for (const f of findings) console.log(`${f.sev === "ERROR" ? "ERROR" : "WARN "}  ${f.where}: ${f.msg}`);

const slideCount = Array.isArray(doc?.slides) ? doc.slides.length : 0;
console.log(
  `\n${file}: ${slideCount} slide${slideCount === 1 ? "" : "s"}, ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warns.length} warning${warns.length === 1 ? "" : "s"}.`
);
if (errors.length === 0) console.log("OK — safe to import.");
process.exit(errors.length ? 1 : 0);
