# UX-PLAN — the work, in waves

The itemised findings behind `PULSE.md` §3, from a full audit of the player
and host surfaces against the six principles (T1–T6) and the canon (`PULSE.md`
§1). Every item was verified in the current code; line numbers are anchors,
not contracts — trust the symbol over the number.

Ordered by who pays and how publicly: a room watching beats a player under a
countdown beats a host at a desk — except Wave 0, which is cross-cutting:
the navigation shell every other journey rides on. Within a wave, items share
files and should ship together.

## Status — 15 November 2026

Waves 0–5 and the Present-side half of Wave 6 are **implemented** in the
working tree (not yet committed), each driven through the real interface in
an isolated stack (Playwright + scratch Postgres), then the whole thing driven
once more as one continuous session — host sign-up through podium, including
a server SIGKILL mid-question — at **87 of 87** after two integration bugs were
fixed (below). `npm run build`, `lint`, `lint:design`, `test` and
`audit:themes` are clean on the client; `build` and `test` on the server; the
two real audits are now CI gates.

| Wave | Items | Landed | Evidence (from the harness runs) |
|---|---|---|---|
| 0 Navigation | 0.1–0.6 | all | one `<header>` on every signed-in page; ⌘K → type → Enter lands in the editor; filter 8→1 rows; switcher lists other decks; History has `Edit deck` |
| 1 Stage | 1.1–1.8 | all | blocked pop-up → footer notice, stage intact; ⌘L → 0 frames broadcast; `B` blanks; server SIGKILL → footer banner in 9–20 ms, "Back online" on restart; AUDIENCE deck → no ring |
| 2 Under the clock | 2.1–2.8 | all | tap → tile `chosen` in 4–14 ms; 6 options fit 375×667 (content 455/455, no scroll); Q&A tab pulled back on `Next` |
| 3 First minute | 3.1–3.8 | all | pasted `Join with code 157 770` joins; bad code errors inline with the code kept; slur → "The room will see you as Anonymous" |
| 4 Last minute | 4.1–4.4 | all | `#2 of 3`, personal line first; 320 px `scrollWidth ≤ clientWidth`; reload identical; "1 of 3 have answered" |
| 5 Editor trust | 5.1–5.10 | all | `Saving…` → `Saved · just now` in ~410 ms; aborted PATCH → `Couldn't save — retrying` → recovers; time limit sends exactly `[5, 45, 600]`; option undo never sends a short list; duplicate 2 of 5 → slide 3; drag + keyboard reorder persist |
| 6 Weight | 6.1, 6.3–6.7, most of 6.8 | partial | `Present` is the row's accent; `Next` x stays 621.98 when `Scores` appears; one `downloadSessionCsv` for all three surfaces |

**Fixed during integration** (found only by the combined run):
- A phone on a finished room's podium, pointed at a *new* code by URL (the
  next session's QR into the same tab), kept the old podium while the join
  effect silently seated it in the new room. `/join/:code` now remounts
  `Play` per code (`App.tsx`, `PlayByCode`).
- An editor `load()` landing while a title PATCH was in flight could snap the
  title back to its pre-edit value (2 of 7 runs). `autosave.unsaved(key)`
  now exposes in-flight + pending fields and `load()` overlays them.

**Closed since** (measured in a headless Chromium against the dev stack):
- **Stage lag.** `AnimatePresence` on the stage is `popLayout`, not `wait`;
  the leaving frame is lifted out of flow and exits in 160 ms while the new
  one enters. Key press → new question at ≥0.5 opacity on the stage: median
  **437 ms → 108 ms** over the nine transitions of the 90s example deck.

**Still open**, in cost order:
- **6.2** deck health (`⚠ 2 issues`), authored-duration estimate and
  last-presented date on the deck list — only `updated …` landed.
- **The final-results screen fails the 24 px stage floor** (pre-existing,
  measured by hand): `Podium`/`LeaderboardList` labels at 11–16 px and four
  17 px buttons on a projected surface. It is a signature moment and needs a
  design pass, not a size bump.
- **The 24 px-floor and contrast audits are not scripts** (`DESIGN.md` §6 now
  says so). Measurement debt below.
- 6.8 leftovers: `DeckTransfer` `onDrop` not gated on `importing`;
  `SaveIndicator` shows nothing (rather than `Nothing to save yet`) before the
  first save.
- 6.4's "hide Q&A/Moderate when the deck has Q&A off" — no such deck flag
  exists; needs a server field.

---

**Ledger corrections** — two `TODO.md` entries were stale and have been
updated:
- *"The editor never refuses"* is done: `configIssues` are surfaced in the
  header counter, `DeckCheck`, and inline per-field (`Editor.tsx:87-124, 365-384,
  606-707, 983-994`).
- *"Drag reorder … untested through the actual interface"* describes a feature
  that does not exist — reorder is adjacent-swap buttons only
  (`Editor.tsx:266-286`). See item 5.4.

---

## Wave 0 — Navigation: kill the hub bounce (FLOW F7)

The product's navigation graph is a hub-and-spoke where only the hub
(`Dashboard`) links anywhere: Templates and Import are reachable **only** from
the Dashboard header (`Dashboard.tsx:106,113`); Templates and Import link only
back (`Templates.tsx:71`, `DeckTransfer.tsx:115`); the Editor reaches only its
own deck's places (`Editor.tsx:334,347,389`); History reaches only Dashboard
and Present (`History.tsx:142,163`). And the hub's list has **no search**, is
sorted by an `updatedAt` it never displays, and was tested by FLOW itself at
104 rows. So every cross-journey is `spoke → hub → O(n) scan → spoke` — the
measured source of "everything is three clicks away":

| Errand | Today |
|---|---|
| Edit deck A → edit deck B | 3 presses + 104-row scan |
| History (results) → fix the question in the editor | 3 presses + scan |
| Templates → Import | 2 presses, through the hub |
| Editor → Templates | 2 presses, context lost |
| Anywhere → present this week's deck | 2–3 presses + scan |

**0.1 · One shared `AppShell` header** — P1 applied to doors. Five pages
hand-roll five headers (`Dashboard.tsx:93`, `DeckTransfer.tsx:102`,
`Templates.tsx:59`, `History.tsx:125`, `Editor.tsx:326`); only one of them
carries the global links. Extract one header: wordmark · `Decks` · `Templates`
· `Import` (+ the page's own crumb/actions slot). Every global place becomes
one press from everywhere, and the next global destination costs a component
edit instead of five.

**0.2 · The deck list gets a filter field** — the floor of F7's third rule.
Autofocused type-to-filter above the rows (the `SlideTypePicker` filter is the
in-house pattern); match on title. Also surface what the sort key is:
`updated 3d ago` metadata on the row (shared with item 6.2). A 104-row scan
becomes four keystrokes.

**0.3 · `⌘K` command palette** — the ceiling, and the expert path. One
surface that jumps to any *named* thing: decks (verbs: `Edit` default,
`Present`, `History`) and places (`Templates`, `Import`, `New deck`). The
pieces exist: `lib/arrowFocus.ts` for the keyboard contract, the type picker
for filter-first modal shape, `MoreMenu` for the item row. Any place → any
place = ⌘K · type · Enter, zero scans, zero hub. (Jakob: ⌘K is a 2026
convention as settled as drag-reorder.)

**0.4 · The editor's deck title becomes a switcher** — switching ≠ choosing
(F7's second rule). The header already names the deck; make it a menu:
recent five decks + `All decks…`. Every document editor (Figma, Docs,
Keynote) has this; moving between two known decks stops passing through a
scan. Pairs with 5.8 (`Back to the room` state) — the switcher must carry the
same `· live` marker so a host cannot switch away from a live deck unknowingly.

**0.5 · History gets `Edit deck`** — the one-way spoke. From a session's
results — exactly where a bad question announces itself — the editor is 3
presses + a scan away (`History.tsx` links only to Dashboard/Present). Add
`Edit deck` beside `Present` in its header.

**0.6 · Recents strip on the Dashboard** — Pareto, measured not assumed: a
host presents the same deck weekly. Top 3 by `updatedAt`/last-presented as
large cards above the list (serial position: first = cheapest), each carrying
`Present` + `Edit`. The weekly errand becomes one press from login.

**Verify wave 0:** re-run the errand table — every row ≤ 2 presses, no
unsearched scan; ⌘K reaches a deck by name from every signed-in page; five
`<header>` implementations become one.

---

## Wave 1 — The stage goes dark (presenter blockers)

The room sees every one of these.

**1.1 · One string replaces the entire presenter view** — T2, F1/F2.
`Present.tsx:621` — `if (error)` returns a bare centred `<p>{error}</p>`:
no bar, no exits, no join code. Set by a failed `create-session` ack *and* by
a blocked speaker-notes pop-up (`:824` — "Allow pop-ups…"), i.e. a live
session with 28 phones goes blank because of a browser setting. Also renders
UI-ladder `text-title2` on a projected surface (under the 24 px floor).
**Fix:** pop-up failure becomes a transient notice on the control bar; the
full-screen form is reserved for pre-session failures and gains `← Decks`.

**1.2 · The presenter has no connection awareness; every command is
fire-and-forget** — T2. `lib/connection.ts` (retry queue, status, banner) is
imported only by `participant/Play.tsx`. `Present.tsx` passes no-op acks on
`next`/`prev`/`goto`/`end`/`show-leaderboard` and has no `disconnect`
handler: a dropped socket freezes the answered-counter silently, a dead
clicker press gives nothing, and `SESSION_GONE`/`UNAUTHORIZED` rejections are
swallowed. **Fix:** presenter adopts the same ack+timeout wrapper and a
desk-distance `ConnectionBanner` in the control bar (never on the stage).

**1.3 · Self-paced decks project a countdown that means nothing** — T3.
`create-session` acks `pacing`; `Present.tsx` never reads it, and renders
`TimerRing` from the host's own `startedAt` on any `isQuiz` slide while the
server deliberately arms nothing (`session.ts` — `armRevealTimer` returns
early for AUDIENCE). The room watches zero arrive and nothing happen. The
phone got the honest treatment (FLOW §6.3); the stage never did. **Fix:** on
AUDIENCE decks the stage shows no ring — show "everyone at their own pace"
status plus answered-count; the bar says the deck is self-paced.

**1.4 · ⌘F, ⌘L, ⌘G drive the room** — T2, Jakob. `Present.tsx:528-545` —
the key handler guards only `HTMLInputElement`/`TextArea`; no
`metaKey/ctrlKey/altKey` check. Browser-find drops fullscreen; focusing the
address bar **broadcasts the leaderboard to every phone mid-question**.
**Fix:** bail on any modifier key.

**1.5 · There is no way to blank the screen** — Jakob, F2. No `B`/`W`
handler; PowerPoint/Keynote/Slides have shipped it for twenty years. The only
way to take the stage down is `End`, which destroys the session — the cheap
non-destructive act is missing, so the destructive one is the only exit.
**Fix:** `B` toggles a black stage (and `W` white, matching stage-light),
shown in the navigator's shortcut list; plus `Home`/`End` for first/last, and
one discoverable shortcut sheet (`?`).

**1.6 · The deck list launches an empty deck into 1.1's dead end** — F5.
`Dashboard.tsx:211-215` — `Present` is an unconditional `<Link>` even on a
row reading `0 slides`; the editor's own Present is guarded. Server rejects
`EMPTY_DECK` → the no-exit error screen, projector already live. **Fix:**
disable with reason, or route to the editor's empty state.

**1.7 · The presenter never names the deck it is presenting** — F4.
The ack carries `slideTitles` but no deck title; the status strip shows
`Lobby · 3/10 · counts`. Fails F4's own screenshot test on the screen where
the wrong deck is most expensive. **Fix:** deck title on the create-session
ack and in the status strip (and lobby corner).

**1.8 · The speaker window is Keynote with the clock and transport removed**
— Jakob, T4. `SpeakerWindow.ts` shows notes/next/counts but no countdown (on
a timed quiz the host checks the wall) and has no keyboard handler of its own
— space/→ in the speaker window does nothing. **Fix:** mirror the ring and
forward transport keys from the child window.

**Verify wave 1:** block pop-ups and open speaker notes mid-session — stage
survives with a notice. Kill the server mid-question — bar says so in ≤1 s,
stage stays. Run an AUDIENCE deck — no ring on stage. Press ⌘L — nothing
broadcast. Press `B` — stage blanks, room intact. `Present` on a 0-slide row
— never reaches a dead end.

---

## Wave 2 — The player under the clock (T1 + T4 on the phone)

**2.1 · The "Ask a question" tab is a one-way door** — T4, Hick.
`Play.tsx:1062` — the content column is `tab === "qa" ? <QaPanel/> : …`, and
`setTab` is written only by the tablist click (`:1147`) and self-paced
`goto()` (`:728`); `onSlideChanged`/`onReveal` never touch it. A host-paced
player who taps it once sees no further questions all session and scores zero,
with no badge saying a question is live. **Fix:** `setTab("answer")` in
`onSlideChanged`; live-dot on the Answer tab while `showTimer`.

**2.2 · An answer tap changes nothing on the tile tapped** — T1.
`multipleChoice.tsx:200-207` — single-select passes no `state`; the tile
stays `idle` until the server ack. The only feedback is the 13 px
"Sending your answer…" strip ~200 px from the thumb, and the live tiles let a
second tap silently *replace* the answer (the first submit settles `null`,
`Play.tsx:856` returns early — zero visible trace). The `chosen` state already
exists (`AnswerTile.tsx:69,139-153`) and is used only by multi-select.
**Fix:** set `chosen` optimistically on pointer-down before the emit; lock
the grid; reconcile on ack/failure.

**2.3 · Fixed chrome eats ~30% of the phone; six options must scroll under a
countdown** — T4, Fitts. Header ≈121 px + footer ≈156 px (reactions `h-14`,
tabs `h-11`) leaves ~382 px on a 375×667 phone; four `min-h-[88px]` tiles need
388 px, six need 588 px. Worse, the scroll container is
`justify-center … overflow-y-auto` (`Play.tsx:1051`) — the classic case where
block-start overflow is unreachable, likely making option A unscrollable on a
6-option slide. **Fix:** `justify-content: safe center` immediately; then 2.4.

**2.4 · The thumb zone belongs to reactions and tabs, not the answer** — T4,
Von Restorff. During a live question the bottom 156 px carries 8 non-answer
targets (6 reaction buttons + 2 tabs); the nearest answer tile bottoms out
~209 px up on a 2-option slide. **Fix:** collapse `ReactionBar` + tablist to
one slim affordance while `showTimer && !answered`; expand at reveal — which
is when a reaction is worth something.

**2.5 · Safe-area is dead, and on the wrong element** — Fitts.
`index.html:6` lacks `viewport-fit=cover`, so `env(safe-area-inset-*)`
resolves to 0 on every notched iPhone; the only use (`ReactionBar.tsx:123`)
isn't the bottom-most element anyway (tablist renders after it). The 44 px tab
row sits in the home-indicator gesture area. **Fix:** `viewport-fit=cover`;
pad the footer, not the bar.

**2.6 · The tile stagger delays every animation, not just mount** — T1.
`AnswerTile.tsx:104` — `delay: index * 0.045` in the shared transition: the
`chosen` keyline and correct-stamp on slot F start 225 ms late. **Fix:** scope
the delay to the mount animation.

**2.7 · "Sending your answer…" flashes on every healthy submit** — T1
(inverse clause). `connection.ts:347` notifies synchronously, so the
warning-shaped strip springs in and straight back out on every 40–80 ms ack.
**Fix:** delay the banner's appearance ~400 ms; then it only shows when true.

**2.8 · The question is clamped to three lines with no way to read the rest**
— T6 (output side). `Play.tsx:1030` — `line-clamp-3`, no expand; the comment
above it argues remote players need the question, and a remote player is
precisely who a truncated question strands. **Fix:** tap-to-expand, or give it
the space 2.4 frees.

**Verify wave 2:** Slow-3G throttle — every tap answers on the tile in
≤100 ms, second taps are dead, no banner on healthy submits. 6-option slide on
375×667 — all options reachable, no non-answer target in the thumb arc while
live. Tap Q&A mid-game — next slide pulls the phone back.

---

## Wave 3 — The first minute (T5 + T6 at the join)

**3.1 · A wrong code is discovered only after the nickname, and the error
discards the code** — T5, T2. The join emit is gated on nickname submit
(`Play.tsx:300, 888-900`), so: code → new screen → nickname → submit → *then*
`BAD_CODE` → a third screen whose one button lands on an **empty** field
(`Join.tsx` has no way to seed from the URL). Five correct digits thrown away.
The same screen shows for `RATE_LIMITED`, where "Try another code" is wrong
advice. **Fix:** validate the code before the nickname (lightweight
`session:peek` or nickname-first); pre-fill `/join/<code>` on error; branch
the copy by error code.

**3.2 · The join field eats any paste that isn't six bare digits** — T6.
`Join.tsx` — `maxLength={6}` truncates *before* the `.replace(/\D/g,"")`
sanitizer runs: `157 770` → `15777`; `Join with code 157770` → `""`, no
message. **Fix:** drop `maxLength`, sanitize then `.slice(0,6)` — every
paste out of Slack/WhatsApp then works. Show the normalised code (T6: the
normalisation is shown).

**3.3 · On iOS there is no keyboard submit, and the button can sit behind the
keypad** — Fitts. `inputMode="numeric"` renders the 10-key pad (no Go key,
no `enterKeyHint` possible), and the centred `h-[100dvh]` form doesn't shrink
for the keyboard, putting Join in the occluded band on a 667 pt phone.
**Fix:** auto-submit at six digits (the field is fixed-width; the button
leaves the critical path). Secondarily a `visualViewport`-aware anchor.

**3.4 · A nickname the server rewrites is never echoed back** — T6, T2.
`contentFilter.ts` can replace a name with "Anonymous" and `session.ts`
truncates at 24 chars, but the join ack carries no `name` — the phone says
"You're in, Dave" while the wall says "Anonymous", unexplained and unfixable.
**Fix:** `name` on the ack; `setName(res.name)`; one line of copy when it
differs.

**3.5 · The nickname field lacks the keyboard guards the answer field has** —
T6. `Play.tsx:1200-1208` — no `autoCapitalize/autoCorrect/spellCheck/
autoComplete/enterKeyHint`; `typeAnswer.tsx:145-157` turns these off with a
comment about keyboards rewriting proper nouns — and here the rewrite is
projected on a wall. **Fix:** copy the guards.

**3.6 · The homepage leads with the host's action and has no code field** —
Von Restorff, Pareto. `Home.tsx:67-76` — "Host a session" is the primary XL
button and first in DOM; players outnumber hosts ~30:1 and typed arrivals get
no field at all (Kahoot/Menti both lead with it). **Fix:** code field first,
host path secondary.

**3.7 · `ErrorBoundary` shows a player a raw JS message and the wrong door**
— T4. `ErrorBoundary.tsx:26-30` — `error.message` verbatim; only "Go home",
abandoning a still-valid seat. **Fix:** "Back to the game" primary
(`#/join/<code>`), home secondary, plain copy.

**3.8 · Browser chrome** — `<title>client</title>`, no `theme-color`
(`index.html`). The player's tab, history and share sheet all say "client".

**Verify wave 3:** paste `Join with code 157 770` — lands in the lobby in two
inputs. Mistype one digit — the error arrives *before* the nickname step and
the code survives. Join with a slur as a nickname — the phone tells you what
the room will see.

---

## Wave 4 — The last minute (T5 at the ending)

**4.1 · The podium overflows every standard phone** — T5, Prägnanz test.
`Podium.tsx:61-127` — non-wrapping row, 456 px minimum (176 + 2×128 + gaps)
inside `px-5` on a 375 px screen with `overflow-hidden` on the shell: #2 and
#3 are clipped in half, unscrollable, on the biggest emotional moment in the
product. **Fix:** a phone-sized podium variant (stacked or scaled), tested at
320 px.

**4.2 · The ending is identical for 1st and last** — T5, Von Restorff.
`SessionEnded` (`Play.tsx:1340-1398`) — confetti unconditionally, then a
podium of (usually) strangers, then your own line smaller below: two things
competing for emphasis and neither is yours. **Fix:** the player's own result
is the accent (rank-up animation, personal line first); confetti gated on
podium finish; `totalPlayers` on the wire so `#11` becomes `#11 of 34` —
the difference between a ranking and a result. Optional one personal scalar
(best answer / fastest correct) — the server already computes `fullEntries`.

**4.3 · After answering, the phone says nothing about the room** — T2,
goal-gradient. The host-paced wait card is "Hold tight…" + ⏳ for 15+ s with
no bound. The stage already shows answered-counts; phones never get them
(only `participant:count` is broadcast). **Fix:** broadcast the answered
count; "14 of 32 have answered" is the cheapest honest tension-holder there
is.

**4.4 · The lobby is a dead room with no door** — T4, F2. `Play.tsx:1218-1258`
— greeting, bubbles, count; no ReactionBar, no Q&A, no leave, no fix-my-name.
Lobbies run 2–10 minutes; this is where Q&A is *most* useful (inverse of
where it's offered). **Fix:** mount reactions + Q&A in the lobby; add
`Leave` and edit-name affordances (F2: leaving is not ending).

**Verify wave 4:** finish 11th of 34 on a 320 px phone — an unclipped,
personal, bounded ending. Reload on it — byte-identical (already fixed;
don't regress).

---

## Wave 5 — The editor's trust (T2 at the desk)

**5.1 · Autosave is invisible and failure is silent** — T2. No save
indicator exists anywhere (`grep "Saving\|Saved"` → one comment). Every write
is unguarded: `save()` (`Editor.tsx:910-917`, no catch, fired from
`onChange`), `renameTitle` (`:288-292`, one PUT per keystroke), `patchDeck`
(`:296-300`). `api.ts:38-41` throws on non-2xx → unhandled rejection while
the editor renders the edit as applied; `question` saves only on blur, so
⌘W after typing loses it silently. **Fix:** one debounced save pipeline with
a `Saved · just now / Saving… / Couldn't save — retrying` indicator in the
header, retry-with-backoff, and a dirty-state `beforeunload` guard. This is
T2's worst case: not >1 s without acknowledgement — *forever* without it.

**5.2 · Time-limit fields accept what the server silently rewrites** — T3,
T6. `multipleChoice.tsx:159-167` (+ `guessNumber`, `typeAnswer`) —
`type="number"` writes per keystroke; clearing saves `0`, typing `45` saves
`4` then `45`; HTML `min/max` don't block typing and the server clamps at
runtime without saying so. **Fix:** clamp on blur with the clamped value
shown; never persist a keystroke-intermediate.

**5.3 · Deleting an option is one-press irreversible; deleting a slide is
not** — F5. `multipleChoice.tsx:95-102` → immediate PUT (same in `ranking`,
`hundredPoints`, `typeAnswer`); no ⌘Z exists (no keydown handler in the
editor at all), while slide and deck deletes got the 6 s undo. **Fix:**
cheapest honest version — a 6 s field-level undo via the existing `UndoBar`,
or an editor-level undo stack for config edits.

**5.4 · Slides append-only; reorder is adjacent-swap at 24 px** — Jakob,
Fitts. New slides and **duplicates** append to the end
(`presentations.ts:160-168`, `Editor.tsx:221-231`); reorder is two 24×24 px
buttons, `opacity-0` until hover (`:473, 852-874`), one server round-trip per
step, and `move()` drops presses while `busy` (`:269`) — inserting after
slide 5 of 20 is fifteen hover-and-hit passes. **Fix:** duplicate inserts
below its source; "add after selected"; drag reorder (every comparable tool
has it — Jakob) with the swap buttons kept for keyboard.

**5.5 · `+ Add slide` scrolls off the rail** — Pareto/F5. `Editor.tsx:424,
497-506` — the rail's highest-frequency control is the last child *inside*
the scroll container; on 25 slides it needs a scroll to reach. **Fix:** pin
it below the scroll area.

**5.6 · "Pacing" and "Pace" are adjacent, near-identical labels for unrelated
decisions** — P1 mirror-defect. `Editor.tsx:729` (who drives the deck) vs
`:795` (`timeScale`, the relaxed-timing accessibility setting), two columns
apart in one band; nothing says the second is about accessibility. **Fix:**
rename (`Who advances the slides` / `Answer time · ×1.5 relaxed`), separate
the bands.

**5.7 · The consequence of a pacing choice lives in a `title=` tooltip** —
F-pattern already fixed once. `Editor.tsx:742, 776` — the exact pattern FLOW
§3 records fixing for the type picker ("written, but hidden in a title
attribute") survives on the two settings with the largest downstream
consequences; the caption describes only the *selected* value. **Fix:**
visible one-liners on both options, before the choice.

**5.8 · `Present` and `Back to the room` are one navigation wearing two
labels and two accents** — similarity misuse. `Editor.tsx:389` and
`LiveRoomBar.tsx:132` both navigate to `/present/<id>`, stacked ~12 px apart,
both primary. The editor already holds `roomLive` (`:162, 314`). **Fix:**
when a room is live, the editor's button *becomes* `Back to the room` (one
line), and the bar stops duplicating it.

**5.9 · Modals have no visible dismiss; the type picker's Enter target is
invisible** — Jakob/Apple Modality. `SlideTypePicker.tsx:84-95`,
`SlideNavigator.tsx:139-157` — `aria-modal` with no close button;
`SlideTypePicker.tsx:55, 102-105` — Enter adds `first` but nothing marks
which card that is (empty filter + Enter silently adds Multiple choice).
**Fix:** an ✕ on both; a ring on the Enter target.

**5.10 · The phone preview vanishes below 1024 px with no notice** —
`Editor.tsx:1012` `hidden lg:block` — its own comment calls it "the fastest
way to catch an option that is too long," and on a 13″ non-maximised window
it silently stops existing. **Fix:** a toggleable preview (or a note that it
is hidden), not a silent drop.

**Verify wave 5:** edit against a dead server — the editor says so within
1 s and nothing renders as saved that isn't. Clear a time limit — it never
persists `0`. Duplicate slide 5 — the copy is slide 6.

---

## Wave 6 — Weight and distinction (dashboard + control bar)

**6.1 · `Present` is not the most distinctive thing on a deck row — `New
deck` is** — Von Restorff, F5's own test. `Dashboard.tsx:149-151, 211-215` —
the page's accent goes to the once-per-deck verb; the highest-frequency verb
in the product is a grey `secondary sm` chip. **Fix:** `Present` primary on
the row; `New deck` can stand down to secondary.

**6.2 · The deck list hides the three facts a host needs and shows none it
sorts by** — F4, Zeigarnik→goal-gradient, Parkinson. Rows show title + slide
count; the list sorts by `updatedAt` it never displays; no deck-health (the
editor computes `brokenSlides`; the launch surface says nothing — a host
presses Present on a deck with three unanswerable questions, unwarned); no
**duration estimate** (nothing sums `timeLimitSec` anywhere — a host planning
a 30-minute slot cannot see what they authored: Parkinson's law, structurally
unanswerable today); no last-presented date. **Fix:** `updated · ~12 min ·
⚠ 2 issues` metadata line; block/warn on Present when broken.

**6.3 · The control bar auto-hides and `Next` relocates mid-question** —
Fitts. `Present.tsx:1081-1095` — 3 s fade; `:1116-1155` — centre-justified
`flex-wrap`, with `Scores` appearing the instant the first answer lands,
shifting every neighbour under a hovering cursor; `nextLabel` also changes
its own width. The most-pressed target has neither reliable size nor
position. **Fix:** fixed slots (reserve Scores' width), left-anchor the
transport group; keep auto-hide for the *stage*, not the bar's hit-targets —
or pause the hide while the cursor is within the bar's band.

**6.4 · The bar's first and last positions go to once-a-session controls** —
Fitts (not memory — see canon). Order: `Edit deck | … | End`. First and last
are the cheapest positions to hit and they hold the twice-a-session and the
destructive. `Start` gets `size="lg"` while `Next` — 80% of all presses — is
`md` mid-row. `Q&A`/`Moderate` are permanent fixtures for a feature many
sessions never use. **Fix:** transport first and large; `Edit deck` into
`More`; `Q&A`/`Moderate` collapse when the deck has Q&A off (needs the
deck-level toggle); grouping by proximity (`gap`), not dividers.

**6.5 · `Room lighting` closes the `More` menu; its neighbours don't** —
`MoreMenu.tsx:172` closes on `checked === undefined`; `Present.tsx:1023-1026`
passes no `checked`. The setting most likely to be flipped twice is the one
that ejects you. **Fix:** pass `checked`.

**6.6 · Three implementations of "download the CSV"; the silent one is on
the live stage** — P1, T2. `History.tsx:95-115` (busy + error),
`LastRunBar.tsx:42-63` (busy + error), `Present.tsx` `exportCsv` —
`if (!res.ok) return;` — no busy, no error, nothing. **Fix:** one
implementation (the `deckFile.ts` pattern), used by all three.

**6.7 · `New deck`/`Duplicate` have no pending state; double-click makes
two decks** — T1/T2. `Dashboard.tsx:36-44, 149-151, 220` vs `Templates.tsx:
39-49` which does the identical call correctly. **Fix:** copy the busy
pattern.

**6.8 · Smaller, grouped:**
- `Moderate` carries no waiting-count badge (`Present.tsx:1190`; the count
  exists inside `QaModeration.tsx:96`) — F4's second sense.
- `Done` on the final screen is the one unnamed door (`Present.tsx:1334`) —
  F1; spell it `Decks`.
- `Show upcoming` names its consequence only *after* the press
  (`SlideNavigator.tsx:168-182`) — say "on the big screen" on the button.
- `exportError` renders as muted body copy indistinguishable from a caption
  (`Dashboard.tsx:157-161`).
- Participant tablist: `role="tab"` with no `aria-controls`/roving
  focus/arrow keys (`Play.tsx:1126-1140`) — the one popup-pattern surface
  `lib/arrowFocus.ts` never reached.
- Participants default muted with no toggle anywhere, so every participant
  `playSound` call is dead code (`lib/sound.ts:60,109`) — expose a lobby
  toggle or delete the calls.
- `scale.tsx:70` hard-codes `grid-cols-5` (a 1–7 scale renders 5+2 ragged).
- `openEnded` has a 500-char box with no counter while `QaPanel` shows one at
  280 — two spellings of one decision.
- `DeckTransfer.tsx:89-94` — `onDrop` isn't gated on `importing`; a second
  drop starts a second import.

---

## Measurement debt (the canon's Tier-3 prompts, made real)

- **Instrument the distribution** (Pareto, spelled honestly): count slide-type
  usage per authored deck and control-presses per session; allocate wave-5/6
  polish by the measured curve.
- **p95 latency marks** (T1/T2): tap→local-ack, submit→server-ack,
  Next→stage-transition; assert the budgets in the existing CI audits.
- **The squint test** (Prägnanz as procedure): render each stage slide type at
  10% scale in CI next to the 24 px-floor audit; diff the block structure.
- **A dead-tap audit** (T1): drive every interactive element under Slow-3G
  throttle and fail anything whose own pixels don't change within 100 ms.

## What is genuinely good — do not regress

The four-channel answer encoding; `typeAnswer`'s keyboard guards; the lobby
QR/code sizing and `unreachable` copy; the import flow's client-side parse and
honest rejections; `EndButton`, `UndoBar`, `MoreMenu`'s keyboard contract;
label→field proximity ratios in the editor; the empty states; ranking's
up/down buttons over drag. The player surface's *content* is carefully
reasoned — nearly every failure above is layout, sequence, or state-reset:
the parts nobody wrote a comment about.
