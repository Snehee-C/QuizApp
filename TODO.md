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

Status: **in progress** (subagent).

---

## Known gaps

### Self-paced players get no answer feedback
`3271aff` stopped AUDIENCE decks auto-revealing (it was closing questions
against the slowest reader). Correct, but it leaves a hole: a self-paced
player who runs out of time now sees nothing until the host ends the session.
The fix is additive and breaks nothing — show a player their own result when
*their own* clock expires. Deliberately not bundled into the removal.

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
