---
name: quiz-deck
description: Author importable deck JSON for the live-quiz presentation app (a Mentimeter-style tool with a presenter stage and phone participants). Use whenever asked to make a quiz, build a deck or slides, create a presentation, write a pub quiz or trivia round, or generate/fix/validate a .json file for Import — covers the 17 slide types, the quiz scoring rules, and a validator that catches a file the importer would reject.
---

# Authoring a deck for the live-quiz app

A deck is **one JSON file**. The host drags it onto the app's Import panel; the
server validates it whole and either creates the deck or refuses the file — it
never half-imports. Your job is to produce a file that imports and then
actually plays: a question that can be answered, a quiz that can be won.

The same document comes back out of `GET /api/transfer/:id/export`, so an
exported deck is the best possible reference for the format.

## Always do this

1. Write the deck to a `.json` file.
2. **Run the validator** in this skill folder:
   ```
   node <skill>/validate-deck.mjs mydeck.json
   ```
3. Fix every `ERROR` and re-run. Read the `WARN`s and fix the ones that are
   really mistakes (an unknown config key is nearly always a typo).
4. Only hand over a file that prints `OK — safe to import.`

The validator knows the server's limits and every type's config. It is cheaper
than a rejected import, and it catches the silent failures the importer does
not — see "What the importer does **not** check" below.

## The envelope

```json
{
  "formatVersion": 1,
  "title": "90s Music Pub Quiz",
  "theme": "ember",
  "pacing": "PRESENTER",
  "filterMode": "mask",
  "slides": [ ... ]
}
```

| Field | Rule |
|---|---|
| `formatVersion` | Must be the **number** `1`. Compared with `===`, so `"1"` is refused. Missing → the file is rejected as "not a deck export". |
| `title` | Optional, text, ≤ 200 chars. Blank/missing → "Imported deck". |
| `theme` | Optional, one of `floodlight` (default), `ember`, `tide`, `paper`. Anything else imports but silently falls back to floodlight. |
| `pacing` | Optional, `PRESENTER` (default; host drives) or `AUDIENCE` (self-paced). Upper case, exact. |
| `filterMode` | Optional, `off`, `mask` (default) or `block` — profanity handling for text answers. Lower case, exact. |
| `slides` | Optional array, ≤ 200 entries. |

The file *is* the deck object. Do not wrap it in `{"deck": …}` — the app's
uploader does that itself when it POSTs to `/api/transfer/import`.

## A slide

```json
{
  "order": 0,
  "type": "MULTIPLE_CHOICE",
  "question": "Which band released OK Computer in 1997?",
  "config": { "options": ["Blur", "Radiohead", "Oasis", "Pulp"], "isQuiz": true, "correctIndices": [1], "timeLimitSec": 20 },
  "notes": "Answer: Radiohead, 1997."
}
```

| Field | Rule |
|---|---|
| `type` | Required, one of the 17 types below. An unrecognised type rejects the **entire file**, not just that slide. |
| `question` | Optional text, ≤ 500 chars. On content slides this is the only visible text. |
| `config` | Optional **nested JSON object** — per-type, see the reference. Max 20KB serialised, per slide. |
| `notes` | Optional presenter notes, ≤ 4000 chars. Never shown to the room. |
| `order` | Written on export, **ignored on import**: the importer renumbers from array position. Keep it equal to the array index so the file does not lie about itself. |

`config` is a real object. Never a string containing JSON — the server
stringifies it for storage on the way in, so a pre-stringified blob gets
double-encoded and the slide renders with no options at all.

## The 17 types

```
Ask the room  MULTIPLE_CHOICE  WORD_CLOUD  SCALE  OPEN_ENDED
              RANKING  HUNDRED_POINTS  GRID_2X2  PIN_ON_IMAGE
Quiz          GUESS_NUMBER  TYPE_ANSWER
Content       CONTENT_HEADING  CONTENT_BULLETS  CONTENT_QUOTE
              CONTENT_BIG_NUMBER  CONTENT_IMAGE  CONTENT_INSTRUCTIONS
              SPIN_WHEEL
```

Full per-type config, defaults and gotchas: **[SLIDE-TYPES.md](SLIDE-TYPES.md)**.
Read the entries for the types you are actually using — you do not need twelve
specs to write a heading.

## The four rules that break most decks

**1. Only three types can score.** `MULTIPLE_CHOICE`, `GUESS_NUMBER` and
`TYPE_ANSWER` have a `grade()` on the server. Nothing else does — a word cloud,
a ranking or a heading with `correctIndices` on it is not a scored question, it
is the wrong slide type.

**2. `isQuiz: true` is what turns scoring on — and the countdown with it.**
All three scorers start with `if (!config.isQuiz) return 0 points`, and all
three define `isTimed` as `!!config.isQuiz`. An answer key with `isQuiz`
missing gives you a question that looks right, runs no clock, never
auto-reveals and leaves the whole room on zero. Set it on every quiz slide.

**3. `correctIndices` holds 0-based indexes into `options`, not answer text.**
With `["Blur", "Radiohead", "Oasis", "Pulp"]`, the answer "Radiohead" is
`[1]`. The last option is index `3`. `["Radiohead"]` and `[4]` both import
cleanly and then mark everyone wrong.

**4. Two correct answers need `allowMultiple: true`.** Grading a multi-answer
key requires the player's picks to equal the key exactly — there is no partial
credit — so with `allowMultiple` off the player physically cannot submit a
winning answer.

## What the importer does **not** check

The server validates the envelope, the slide types and the config *shape*
(object, under 20KB, no `__proto__`). It does **not** look inside a config:
a `MULTIPLE_CHOICE` with zero options, a `PIN_ON_IMAGE` with no image and a
quiz with an out-of-range answer key all import successfully and then fail in
front of a room. That gap is exactly what `validate-deck.mjs` fills, which is
why running it is not optional.

## Writing good quiz content

- Put the answer and any trivia in `notes` — the host reads it aloud, the room
  never sees it.
- `timeLimitSec` 15–20 for a recall question, 25–30 if there is text to read or
  type. Clamped to 5–600 regardless.
- Open with a `CONTENT_HEADING` and a `CONTENT_INSTRUCTIONS` ("How to join")
  so late arrivals can get in, and break a long quiz into rounds with headings.
- Mix the types. Twenty `MULTIPLE_CHOICE` slides in a row is a worse quiz than
  fifteen plus a `TYPE_ANSWER`, a `GUESS_NUMBER` and a `WORD_CLOUD` warm-up.
- Wrong options should be plausible. One obviously silly option turns a
  four-way question into a two-way one.

## Worked example

`examples/skilltest-90s-quiz.json` — a 10-slide 90s music pub quiz using
headings, instructions, word cloud, multiple choice (single and multi-answer),
type-answer, guess-the-number and a closing big number. It passes the
validator and has been imported and round-tripped against a live server.
Copy its shape rather than inventing one.
