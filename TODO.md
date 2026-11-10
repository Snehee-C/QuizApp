# TODO

Open work, roughly by value. `FLOW.md` §6 and `DESIGN.md` §3 carry their own
lists; this is the cross-cutting one.

---

## Features

### Deck-authoring skill — an installable skill any coding agent can use

**What:** a self-contained Agent Skill that teaches *any* coding agent to emit
valid deck JSON for this app — the same document `GET /api/transfer/:id/export`
produces and `POST /api/transfer/import` accepts.

**Why:** authoring a good 20-slide quiz is the slowest part of using this
product, and it is exactly the work an LLM is good at. Today that knowledge
lives in `server/src/slides/*.ts` — twelve `sanitiseConfig`/`validate` pairs —
so an agent either reads the whole server or guesses and produces a file the
importer rejects. A skill turns "make me a 20-question pub quiz on 90s music"
into a file the host drags into Import.

**Shape:** standard skill layout (`SKILL.md` + supporting files), installable
into `~/.claude/skills/` or a project's `.claude/skills/`. It must carry the
whole contract — envelope, every slide type's config, and the validation rules
that actually reject — because a skill that produces a file the app refuses is
worse than no skill.

**Must be verifiable:** ship a validator the agent can run on its own output
before handing the file over, so correctness is checked rather than hoped for.

Status: **done** — `.claude/skills/quiz-deck/` (`1fb1ce0`). Validator catches
9 of 9 broken decks; the real importer catches 5 of 9.

---

## Security

### A `participantId` is a bearer token with no secret
`participant:join` accepts any `participantId` the caller supplies and binds
the socket to it. There is nothing tying that id to a device — so **knowing
someone's id is enough to become them**: take their seat, see their result,
and overwrite their answers (`participant:submit` upserts by that id).

Surfaced while deciding how wide the leaderboard wire may be. It is the reason
the participant-facing board stays at ten rows while the presenter's widens to
200: every row carries a `participantId`, so a full board broadcast to phones
would hand every player in the room the keys to every other player.

Mitigated today only by ids being long and random, and by the board being
capped. The real fix is a per-seat secret issued on first join and required
thereafter — which also fixes the "second tab evicts the real player" family
properly rather than by socket bookkeeping.

Pre-existing, not introduced by any wave. Recorded because it currently
constrains an unrelated design decision, which is how an implicit security
assumption usually announces itself.

---

## Known gaps

### Config validation stops at the importer
Server-side per-slide config validation now rejects a broken deck on import
(12 of 13 adversarial cases, was 0 of 13). Two places it deliberately does not
reach yet:

- **The editor never refuses.** `presentations.ts` returns `configIssues:
  string[]` in a **200** body rather than a 400, because the editor autosaves
  on every keystroke fire-and-forget: a 400 would drop the edit server-side
  while the editor rendered it as saved, which is worse than storing a
  half-finished slide. Surfacing those advisories in the editor is the missing
  client half; only after that can the route refuse.
- **A 400-character option label still imports.** A cap needs a number agreed
  with whoever owns the stage fitter (it binary-searches down to the 26px
  `ANSWER_FLOOR` and then stops, so a long label is free to exceed
  `MAX_LINES`), not one invented at the validator.

### The authoring skill and the app disagree about a new slide
`.claude/skills/quiz-deck/validate-deck.mjs` flags the server's own
`defaultConfig()` output as an ERROR: a new `MULTIPLE_CHOICE` ships
`{correctIndices:[0], isQuiz:false}`, and new `RANKING`/`PIN_ON_IMAGE` slides
ship `{}`. The documented authoring tool rejects what the product creates.
The server's rule set deliberately omits those checks (porting them wholesale
would make three slide types impossible to create); the skill should be
reconciled to match rather than the other way round.

### `myResult.rank` has a sentinel where it wants a null
`participant:join`'s `myResult.rank` is `fullEntries.findIndex(...) + 1`, which
yields **0** — not a rank, not `null` — for a participant with no responses.
`session:ended`'s newer `myRank` uses `null` for the same condition. Two
spellings of "no position", and the wrong one is the older and more-used of the
two. Not changed because a client may key off it.

### The self-paced early reveal is not pacing-gated
`armRevealTimer` returns early for AUDIENCE decks by design, but the
"everyone present has answered" early reveal in `participant:submit` is not
gated and *does* fire on self-paced decks — measured, with a single present
participant tripping it. It is harmless today (the phone's own result card
already covers the case, and `RevealCard` taking over is strictly more
informative), but "a self-paced deck never reveals" is stated in several
comments and is not true.

### A slide with an empty question is presentable
Accepted by the editor, by import and by the skill's validator; the stage
renders a blank question. `question` is a slide field rather than config, and
the create route explicitly writes `question || ""`, so every newly created
slide would fail a non-empty rule — it needs to fire on present/import, not on
save.


### A reloading player loses their own result
Pre-existing, surfaced while building the rank embargo. `feedback` is
component state, and the join ack carries `answered`/`myAnswer` but no graded
result — so a phone that reloads after a reveal comes back without `Correct`,
without `+points`, and without its rank. The player is told less than they had.
Fix: put the player's own score and rank on the join ack. Server change.

Status: **done** — `participant:join` now acks `myResult`, which is the
`participant:submit` ack's own shape (`{ isQuiz, correct, points, totalScore,
rank }`) or `null`. The rank embargo is untouched: `leaderboardView` is still
the release signal, so the server restores the whole result and the client
still chooses when the room's half of it is shown.

### A climb from 11th cannot animate
`computeLeaderboard` sends a top ten, so rows 11+ were never on any board the
stage remembers. The bar race now runs over the whole board it receives and
slices only the render, so this is purely a wire limit — a larger board (or a
dedicated "previous standings" frame) gets it for free.

The wire limit is deliberate and is **not** a candidate for simply raising:
every row carries a `participantId`, which is the whole of what
`participant:join` needs to take that seat (see Security, above). Presenter-only
frames widen to 200 because the host already holds the roster; participant
frames stay at ten. The player-facing half of this is now answered separately —
`session:ended` carries a per-socket `myRank`/`myScore`, so finishing 11th or
below gives a real result on the podium even though the board above it cannot
name you.

Status: **done** — a larger board, scoped. Presenter-facing frames carry up to
`STAGE_LEADERBOARD_LIMIT` (200) rows; every participant-facing board stays at
ten, because each row carries a `participantId` and that is the whole of what
`participant:join` needs to impersonate someone. `leaderboard:updated` is also
coalesced (500ms, leading edge, every on-screen moment flushing exactly) — it
fires once per submission, and one 200-row board per answer at a projector
rendering none of them is not a thing to ship.

### The importer does not validate slide config — it accepts decks that cannot work
Found while building the skill, and verified directly. `POST /transfer/import`
checks the envelope, the type allow-list and the config's *shape* (plain
object, ≤20KB, no `__proto__`) and stops. The slide modules' `validate()`
grades a **participant's answer**, not an author's config, and the importer
never calls it.

So a `MULTIPLE_CHOICE` with `correctIndices: [4]` on four options, or with
zero options, or a quiz with no answer key at all, returns **200 OK** — and
fails in front of a room. Measured: validator 3 errors, importer 200.

The skill's `validate-deck.mjs` already encodes the missing rules and catches
9 of 9 where the importer catches 5. The server fix is to apply the same
checks at import, ideally sharing one implementation so the two cannot drift.
Related: `order` is ignored and renumbered; `timeLimitSec` is clamped at
runtime rather than at import, so `0` is accepted and silently rewritten; an
unknown `theme` falls back silently; `timeScale` is missing from the envelope
so it does not round-trip.

Status: **done.** Each slide type now carries a `validateConfig()` next to its
own `validate()`/`grade()` in `server/src/slides/*`, dispatched through the
registry, and import runs it per slide — 12 of 13 adversarial decks now
rejected with a per-slide reason, where 0 of 13 were before, and the known-good
10-slide deck still imports. `timeScale` round-trips (export carries it,
import clamps it, absence defaults — `formatVersion` deliberately not bumped,
since an additive optional key is compatible in both directions). Surveyed
against the live DB: of 539 decks, the 40 that would now fail re-import are all
QA probe decks. What this does **not** cover is in "Config validation stops at
the importer" above.

### Self-paced players get no answer feedback
`3271aff` stopped AUDIENCE decks auto-revealing (it was closing questions
against the slowest reader). Correct, but it leaves a hole: a self-paced
player who runs out of time now sees nothing until the host ends the session.
The fix is additive and breaks nothing — show a player their own result when
*their own* clock expires. Deliberately not bundled into the removal.

Status: **done**, and it was worse than written — the player saw nothing *ever*,
not merely until their clock expired, because every result on the phone was
gated on a room-wide `reveal` that a self-paced deck has no reliable source
for. `FeedbackCard` now resolves into the player's own result under AUDIENCE
pacing, built from the submit ack it already held. The PRESENTER path is
byte-for-byte unchanged, and the card shows the player's result only — never
the answer key, which is still the reveal's to give.

### `slideTitles` is never re-pushed
The presenter's slide navigator reads `slideTitles` from the session ack. Edit
the deck mid-session and the list goes stale; the client degrades honestly but
the data is wrong. Needs a server push.

### `confirm()` where undo belongs
Deck and slide deletion are guarded by a native `confirm()`. Undo is the right
pattern for both — and a native dialog drops some engines out of fullscreen,
which on a presenter screen means flashing the desktop at the room.

### Per-deck reveal preference
`Show upcoming` in the slide navigator is persisted per HOST, so someone
running trivia nights and staff all-hands from one account gets one answer for
both. Per-deck is the right unit; it is a server field.

### Unverified: the lobby bubble ring
The 1.5px inset ring added for QA's G1 (slot-E bubbles reading as holes
against the lobby canvas) was never measured — the harness failed three times
on a navigation race inside `page.evaluate`. It builds and renders; nobody has
confirmed the contrast it was supposed to buy.

---

## Testing debt

- **The editor has never been driven as a UI.** Six QA rounds went through the
  REST API, which is why a missing `Edit` button survived all of them. Drag
  reorder, form-level validation and the six-option preview are untested
  through the actual interface.
- **Real network conditions.** All reconnect testing has been instant local
  socket kills. A 3G-with-loss profile would exercise the retry queue and the
  ack-timeout path far harder.
- **Dev database litter.** Six rounds of harnesses left throwaway decks and
  sessions behind. Harmless, but `liveSessions` is not a clean number.
