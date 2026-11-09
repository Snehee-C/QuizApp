# Slide type reference

Read only the types you are using. Every rule here was taken from
`server/src/slides/*.ts` (what the server does with the config) and
`client/src/slides/*.tsx` (what the app renders from it).

Columns in the summary: **Scores?** = the server has a `grade()` for this type.
**Timed?** = it can run a countdown and auto-reveal. Both are driven by the
same `isQuiz` flag — see [The isQuiz rule](#the-isquiz-rule).

| Type | Group | Scores? | Timed? | Required config |
|---|---|---|---|---|
| `MULTIPLE_CHOICE` | ask | yes (opt-in) | when `isQuiz` | `options` |
| `WORD_CLOUD` | ask | no | no | — |
| `SCALE` | ask | no | no | — |
| `OPEN_ENDED` | ask | no | no | — (config is `{}`) |
| `RANKING` | ask | no | no | `items` |
| `HUNDRED_POINTS` | ask | no | no | `options` |
| `GRID_2X2` | ask | no | no | — |
| `PIN_ON_IMAGE` | ask | no | no | `imageUrl` |
| `GUESS_NUMBER` | quiz | yes | when `isQuiz` | `correctValue`, `isQuiz` |
| `TYPE_ANSWER` | quiz | yes | when `isQuiz` | `acceptedAnswers`, `isQuiz` |
| `CONTENT_HEADING` | content | no | no | — (text in `question`) |
| `CONTENT_BULLETS` | content | no | no | `bullets` |
| `CONTENT_QUOTE` | content | no | no | — (quote in `question`) |
| `CONTENT_BIG_NUMBER` | content | no | no | `value` |
| `CONTENT_IMAGE` | content | no | no | `imageUrl` |
| `CONTENT_INSTRUCTIONS` | content | no | no | — (config is `{}`) |
| `SPIN_WHEEL` | content | no | no | `entries` |

`SPIN_WHEEL` sits in the content group on purpose: it is a host-driven
randomiser, nobody submits anything, so the server marks it non-interactive
exactly like a heading.

---

## The isQuiz rule

Three types can score: `MULTIPLE_CHOICE`, `GUESS_NUMBER`, `TYPE_ANSWER`. All
three begin their `grade()` with `if (!config.isQuiz) return { points: 0 }`,
and all three define `isTimed: (config) => !!config.isQuiz`.

So `isQuiz: true` buys you **two** things at once — scoring and the countdown —
and without it a slide carrying a perfectly good answer key awards nothing,
runs no clock, and never auto-reveals. Nothing in the app warns you. This is
the most common way to ship a "quiz" where everybody finishes on zero.

`GUESS_NUMBER` and `TYPE_ANSWER` exist only to be scored, so set `isQuiz: true`
on every one of them. On `MULTIPLE_CHOICE` it is genuinely optional: leave it
`false` for an opinion poll, set it `true` for a quiz question.

Scoring curve (shared by all three): a correct answer earns 500–1000 points,
scaled by how early in `timeLimitSec` it arrived. A wrong answer earns 0.
There is no partial credit anywhere.

### timeLimitSec

Only read when `isQuiz` is true. Default 20. The server clamps it to
**5–600 seconds** at run time, so `0`, `-1` and `99999` all silently become
something else. Write a value in range so the deck says what it does.

---

## Ask-the-room types

### MULTIPLE_CHOICE

```json
{
  "type": "MULTIPLE_CHOICE",
  "question": "Which band released OK Computer in 1997?",
  "config": {
    "options": ["Blur", "Radiohead", "Oasis", "Pulp"],
    "isQuiz": true,
    "allowMultiple": false,
    "correctIndices": [1],
    "timeLimitSec": 20
  },
  "notes": ""
}
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `options` | `string[]` | — | 2–6. Each must be non-empty. |
| `isQuiz` | `boolean` | `false` | Scoring + countdown switch. |
| `allowMultiple` | `boolean` | `false` | Lets a player pick more than one. |
| `correctIndices` | `number[]` | — | **0-based indexes into `options`.** |
| `correctIndex` | `number` | — | Legacy single-answer form; prefer `correctIndices`. |
| `timeLimitSec` | `number` | `20` | 5–600. |

**`correctIndices` holds indexes, not answer text.** `["Radiohead"]` is not an
error the importer catches — it imports, and then `grade()` compares a number
against a string and every player is marked wrong. With
`options: ["Blur", "Radiohead", "Oasis", "Pulp"]`, Radiohead is `1`. The last
option is index 3, not 4.

**More than one correct answer requires `allowMultiple: true`.** Grading with a
multi-answer key demands the player's pick set equal the key exactly (no
partial credit, so nobody can select everything and always win). With
`allowMultiple` off the player can only ever submit one pick, so a two-answer
key makes the question unwinnable.

Beyond 6 options the answer-slot ladder (colour + shape A–F) wraps and two
options start looking identical on the stage. The editor caps it at 6.

### WORD_CLOUD

`config.maxWords` (default 3, editor range 1–6) — how many words each person
may send. Each word is capped at 40 characters by the server and the cloud
case-folds, so "Chaotic" and "chaotic" become one word. Never scored.

### SCALE

`config.scaleMin` (default 1) and `config.scaleMax` (default 5), both whole
numbers, `scaleMax` strictly greater. The player renders one button per step,
so keep it to about 10 steps. The stage shows the distribution and the average.
Never scored.

### OPEN_ENDED

No config at all — `{}`. Free text, up to 500 characters, shown on stage as
cards. Never scored. Use `filterMode` on the envelope to mask profanity.

### RANKING

`config.items` (`string[]`, 2–6). Players drag the items into order; the stage
aggregates with a Borda count. There is no "correct" order — never scored.

### HUNDRED_POINTS

`config.options` (`string[]`, 2–6) and `config.total` (whole number, default
100). Players split the budget across the options and it must balance exactly —
that forced trade-off is the point of the format. Never scored.

### GRID_2X2

`config.xLabelLow`, `xLabelHigh`, `yLabelLow`, `yLabelHigh` (all strings,
default `"Low"`/`"High"`). One dot per person on a two-axis plane; the stage
shows the dots, the four quadrant counts and the centroid. Never scored.

### PIN_ON_IMAGE

`config.imageUrl` (required) and `config.caption`. The URL must start with
`http://`, `https://`, `data:image/`, or `/` for a same-origin upload —
anything else is rejected by the renderer and the slide shows nothing. One tap
per person, stored as `{x, y}` normalised to 0–1. Never scored.

Keep `data:` images out of decks you hand to someone: each slide's config is
capped at 20KB and an inline image blows through that immediately.

---

## Quiz types

### GUESS_NUMBER

```json
{
  "type": "GUESS_NUMBER",
  "question": "In what year did MTV first air Unplugged?",
  "config": { "correctValue": 1989, "tolerance": 1, "unit": "", "isQuiz": true, "timeLimitSec": 25 }
}
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `correctValue` | `number` | — | Required, finite. |
| `tolerance` | `number` | `0` | Absolute value is taken. `0` = exact match. |
| `unit` | `string` | `""` | Shown next to the number, e.g. `"km"`. |
| `isQuiz` | `boolean` | — | Must be `true` to score. |
| `timeLimitSec` | `number` | `20` | 5–600. |

Inside tolerance scores on the speed curve; outside scores 0 — closeness earns
nothing, so set `tolerance` deliberately. Note that `tolerance` is part of the
answer key: the server strips it from what participants see, because "within 5"
plus a neighbour's guess brackets the answer.

### TYPE_ANSWER

```json
{
  "type": "TYPE_ANSWER",
  "question": "Who sang \"Wannabe\"?",
  "config": {
    "acceptedAnswers": ["Spice Girls", "The Spice Girls"],
    "caseSensitive": false,
    "isQuiz": true,
    "timeLimitSec": 25
  }
}
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `acceptedAnswers` | `string[]` | — | Required; at least one non-blank. |
| `caseSensitive` | `boolean` | `false` | Turn on only for acronyms / chemical symbols. |
| `isQuiz` | `boolean` | — | Must be `true` to score. |
| `timeLimitSec` | `number` | `20` | 5–600. |

Matching trims the input and collapses internal whitespace runs, then compares
case-insensitively unless `caseSensitive` is set. It does **not** do fuzzy
matching, stemming or punctuation stripping — `"Spice Girls"` will not accept
`"spicegirls"` or `"Spice Girls!"`. List every spelling you will accept,
including the "The …" variant and common abbreviations. Each entry must be 120
characters or fewer; the player's input field stops there.

---

## Content types

None of these take answers, run a clock, or score. The server marks them
non-interactive, which is what makes the socket layer reject a submit and skip
arming the reveal timer. Putting `correctIndices` or `isQuiz` on one does not
make it scorable — it means you picked the wrong type.

`Present.tsx` does not draw the question line above a non-interactive slide:
each content type places its own heading. So for these types whatever you put
in `question` is rendered by the module itself, and an empty `question` leaves
a visibly blank slide.

| Type | Config | What `question` holds |
|---|---|---|
| `CONTENT_HEADING` | `subtitle: string` | The heading |
| `CONTENT_BULLETS` | `bullets: string[]` (max 6) | The heading above the bullets |
| `CONTENT_QUOTE` | `attribution: string` | The quote itself |
| `CONTENT_BIG_NUMBER` | `value: string`, `caption: string` | The line above the number (optional) |
| `CONTENT_IMAGE` | `imageUrl: string`, `caption: string` | Optional caption line |
| `CONTENT_INSTRUCTIONS` | `{}` | The heading, e.g. "How to join" |
| `SPIN_WHEEL` | `entries: string[]` (2–12) | The wheel's title |

`CONTENT_BIG_NUMBER.value` is a **string**, not a number — it is display text,
so `"72%"`, `"1.4bn"` and `"#1"` are all valid and `72` is wrong.

`CONTENT_INSTRUCTIONS` takes no config by design: the join code belongs to the
live session, not the slide, so there is nothing an author can put out of date.

`CONTENT_IMAGE.imageUrl` accepts a slightly wider set than `PIN_ON_IMAGE`:
`http(s):`, `data:image/`, `blob:`, `//`, `/` or a relative `./` path.
