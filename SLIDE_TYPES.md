# Slide types — architecture

Adding a slide type means **adding two files**, not editing ten. Nothing
outside a slide module may branch on `slide.type`.

## Why

Before this, a new question type had to touch six shared files: the editor's
type tables, the player's input switch, the stage's results switch, the
server's aggregator, the server's scorer, and the CRUD allow-list. Six types ×
six files is a merge conflict generator, and the answer-key stripping lived in
exactly one of them — so a new type could silently leak its own answers.

Now each type is a module. The registry is the only shared surface.

## Anatomy

```
client/src/slides/
  types.ts          contract: SlideTypeDef
  registry.ts       the ONE shared file — import + list your module
  multipleChoice.tsx   reference implementation
  <yourType>.tsx

server/src/slides/
  types.ts          contract: SlideServerDef (+ stripAnswerKey, speedPoints)
  registry.ts       the ONE shared file
  multipleChoice.ts    reference implementation
  <yourType>.ts
```

`Slide.type` is a plain `String` column and `Slide.config` is a JSON string, so
**a new type needs no database migration.**

## The client half (`SlideTypeDef`)

| Field | Purpose |
|---|---|
| `type` | Wire value. Must match the server module exactly. |
| `label`, `hint`, `group` | How it appears in the editor's add-slide menu. `group` is `interactive` \| `quiz` \| `content`. |
| `interactive` | `false` for content slides — no answers, no results. |
| `defaultConfig()` | Config for a freshly created slide. |
| `Editor` | The type's settings panel. |
| `Player` | What the phone shows. `null` for content slides. |
| `Stage` | What the projector shows. |
| `Reveal` | Optional: what the phone shows after the answer is revealed. |
| `Preview` | Optional: the miniature in the editor's side panel. |

## The server half (`SlideServerDef`)

| Field | Purpose |
|---|---|
| `type`, `interactive` | As above. |
| `sanitizeConfig` | **Security boundary.** What a participant is allowed to see. Defaults to `stripAnswerKey`. |
| `validate` | Reject malformed values before they reach the database. |
| `aggregate` | Raw responses → the compact payload `Stage` renders. |
| `grade` | Optional scoring. Use the shared `speedPoints()` curve. |
| `isTimed` / `timeLimitSec` | Whether to run a countdown and auto-reveal. |
| `revealPayload` | **The only sanctioned path** by which an answer key reaches participants. |
| `formatForExport` | One CSV cell per response. |

## The rule that matters most

> A participant's browser can read every socket frame it receives.

So the answer key must never be in the slide config sent to the room. The
server emits the stripped slide to the room and the full slide only to the
presenter's own socket; `revealPayload()` is the one place an answer key is
allowed to travel, and only after the reveal has fired.

`publicConfig()` **fails closed** — an unregistered type falls back to the
default strip rather than passing raw config through.

There is a regression test for this: it sniffs a participant's WebSocket frames
and asserts zero of them contain an answer key. Run it after adding a scored
type.


## Registered types

| Type | Label | Group | Scored | Player submits |
|---|---|---|---|---|
| `MULTIPLE_CHOICE` | Multiple choice | ask | opt-in | `number` or `number[]` |
| `WORD_CLOUD` | Word cloud | ask | — | `string[]` |
| `SCALE` | Scale / rating | ask | — | `number` |
| `OPEN_ENDED` | Open ended | ask | — | `string` |
| `RANKING` | Ranking | ask | — | `number[]` (indices, best first) |
| `HUNDRED_POINTS` | 100 points | ask | — | `number[]` (points per option) |
| `GRID_2X2` | 2×2 grid | ask | — | `{x, y}` normalised 0–1 |
| `PIN_ON_IMAGE` | Pin on image | ask | — | `{x, y}` normalised 0–1 |
| `GUESS_NUMBER` | Guess the number | quiz | yes | `number` |
| `TYPE_ANSWER` | Quiz: type answer | quiz | yes | `string` |
| `CONTENT_HEADING` | Heading | content | — | — |
| `CONTENT_BULLETS` | Bullet list | content | — | — |
| `CONTENT_QUOTE` | Quote | content | — | — |
| `CONTENT_BIG_NUMBER` | Big number | content | — | — |
| `CONTENT_IMAGE` | Image | content | — | — |
| `CONTENT_INSTRUCTIONS` | How to join | content | — | — |
| `SPIN_WHEEL` | Spin the wheel | content | — | — (host spins) |

Scored types share one speed curve (`speedPoints`): a correct answer earns
500–1000 points on a linear ramp from how much of the clock was left.

## Beyond slide types

These do not fit the slide contract — they are schema and socket features —
and live elsewhere:

| Feature | Where |
|---|---|
| Audience Q&A (ask, upvote, moderate) | `server/src/sockets/qa.ts`, `client/src/components/qa/` |
| Live reactions | same socket module, `client/src/components/reactions/` |
| Per-deck themes | `client/src/lib/themes.ts`, applied in `Present.tsx` |
| Templates + duplicate | `POST /presentations/:id/duplicate`, `GET /presentations/library/templates` |
| Session history | `GET /presentations/:id/sessions`, `client/src/presenter/History.tsx` |
| Speaker notes | `Slide.notes`, shown in a second window via `components/SpeakerWindow.ts` |
| Audience pacing | `Presentation.pacing`, `participant:goto` |
| Content filtering | `server/src/services/contentFilter.ts` (+ its test) |
| Relaxed timing | `Presentation.timeScale`, applied in `sockets/session.ts` |
| Connection resilience | `client/src/lib/connection.ts` |
| Sound cues | `client/src/lib/sound.ts` (synthesised, no assets) |
| Deck import/export | `server/src/routes/transfer.ts` |

### Content filtering is a speed bump, not a guarantee

`contentFilter.ts` is a blocklist, and blocklists cannot be made exact. It
folds leetspeak and separator evasion (`sh1t`, `f u c k`), matches
root+inflection rather than bare substrings, and carries a short allowlist for
the well-known collisions — the "Scunthorpe problem", where ordinary words
contain a blocked root. `cockpit`, `Scunthorpe`, `shiitake` and `peacock` are
all in the test suite for exactly that reason.

It will still miss novel spellings. For a hostile room the real answer is
`block` mode plus the Q&A moderation queue, not a longer wordlist.

### Relaxed timing changes scoring too

`timeScale` stretches every countdown, and grading uses the **stretched**
window. Scaling only the clock would quietly cost every player points for
answering at the same relative moment, turning an accessibility option into a
scoring penalty.

### The Q&A visibility rule

A `PENDING` question is unmoderated audience text. It reaches **its author and
the host, and nobody else** — not the projector, and not other participants'
phones. `personalise()` in `sockets/qa.ts` enforces this server-side with an
allowlist; `QaStage` independently allowlists `APPROVED`/`ANSWERED` too. Both
layers matter: moderation that only guards the big screen still lets the room
read whatever anyone typed.

## Checklist for a new type

1. `server/src/slides/<name>.ts` — implement `SlideServerDef`.
2. `client/src/slides/<name>.tsx` — implement `SlideTypeDef`.
3. Register in **both** `registry.ts` files.
4. If it is scored: confirm `sanitizeConfig` removes the key, and that the key
   only appears via `revealPayload`.
5. Typecheck both halves; add a slide of the type and walk a live session.

Design constraints for the UI live in `DESIGN.md` — in particular the 24px
stage-text floor, the token-only colour rule, and never encoding meaning in
colour alone.
