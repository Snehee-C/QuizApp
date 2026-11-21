# FLOODLIGHT — Flow

How you move through this product. `DESIGN.md` is what a screen looks like;
this is what happens between two of them.

The brief is the same one, read a level up: **nothing odd or out of place,
every part consistent with every other part.** A system can satisfy that on
every individual screen and still fail it in the joins — and the joins are
where the person actually lives. §6 is the honest record of where it still
fails.

---

## 1. The idea

> **You move *into* things and back *out* of them. Nothing ejects you, and
> nothing you were doing is forgotten.**

A page is a place. A session is somewhere you *are*, not a form you are
submitting. The product's job between two screens is to make the second one
feel like the same building as the first: the way back is visible, it is
labelled, and when you take it the room is as you left it.

Apple's own framing, from the archived iOS HIG, is the whole target in two
sentences:

> "People should always know where they are in your app and how to get to
> their next destination. Regardless of navigation style, it's essential that
> the path through content is logical, predictable, and easy to follow."
> — [Navigation, archived iOS HIG](https://developer.apple.com/design/human-interface-guidelines/ios/app-architecture/navigation/)

And the reason to care, measured rather than asserted — Mark, Gudith & Klocke,
CHI 2008, on what an interruption actually costs:

> "Our data suggests that people compensate for interruptions by working
> faster, but this comes at a price: experiencing more stress, higher
> frustration, time pressure and effort."
> — [The Cost of Interrupted Work](https://interruptions.net/literature/Mark-CHI08.pdf)

That is the finding this document is built on. A navigation defect does not
show up as lost seconds; a competent person absorbs it and goes faster. It
shows up as a host who is slightly rattled in front of a room. Counting clicks
alone would have measured none of what was wrong here.

---

## 2. The seven principles

### F1 — Every room has a door, and the door says where it goes.
A control that offers to take you somewhere must name the somewhere. A bare
`←` is a **direction, not a destination**: it says leaving is possible and
nothing about where you land, so the only way to find out is to press it.

This is `DESIGN.md` P1 applied to verbs instead of tokens. If two controls in
one bar both read `←`, one glyph is carrying two different journeys and the
system has a dialect.

**Test:** cover the browser chrome. From on-screen text alone, name every way
out of this screen and where each one lands. A screen with zero named exits
fails. A screen whose only named exit is destructive fails harder.

### F2 — Leaving is not ending.
Stepping out of a live room is not the same act as closing it, and the
product must never price the first as the second. The session survives on the
server; the host's *knowledge* that it survives is the thing the interface
owes them.

> "Users often perform actions by mistake. They need a clearly marked
> 'emergency exit' to leave the unwanted action without having to go through
> an extended process."
> — [NN/g, User Control and Freedom](https://www.nngroup.com/articles/user-control-and-freedom/)

The inverse matters as much: the exit that *destroys* must cost more than the
exit that doesn't. Equal cost is a claim about equal consequence, and it is
false.

**Test:** from any live state, is there a non-destructive exit at least as
findable as the destructive one? If getting back depends on whether the
browser kept a history entry, it fails.

### F3 — A place you return to looks the way you left it.
Selection, scroll, the open room, the slide you were editing. The resumption
cost of a navigation should be zero, because the person paid the interruption
cost already (§1) and the interface cannot charge them twice.

> "The mobile app or website must save state at all times and be prepared for
> such interruptions … so that the user doesn't have to redo work already done
> before the interruption."
> — [NN/g, Mobile UX](https://www.nngroup.com/articles/mobile-ux/)

> "As views push in, it feels natural to swipe left to right to go back to
> where you came from **without losing access to hierarchies in other tabs
> where your state should be preserved**."
> — [WWDC22, Explore navigation design for iOS](https://developer.apple.com/videos/play/wwdc2022/10001/)

**Test:** open a screen, change its state, navigate away, come back, diff.
Every difference is a defect unless the underlying content changed.

### F4 — The system says where you are, unprompted.
Both senses of "where": your position in the hierarchy, and what is happening
elsewhere in the product that concerns you. A room with twenty-eight phones in
it waiting on a frozen slide is *your current context* even when you are
looking at a text field.

> "When we understand the system's state, we feel in control … The
> predictability of the interaction creates trust."
> — [NN/g, Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/)

Recognition over recall ([heuristic #6](https://www.nngroup.com/articles/recognition-and-recall/))
is the same rule stated from the other side: the host should not have to
*remember* that a room is open.

**Test:** screenshot any screen, with no history and no memory of arriving.
Can a person say which deck this is, where it sits, and what is live?

### F5 — Weight tracks frequency; irreversible is never one press.
Six controls at identical size on a row is a claim that they are used equally
often. On a deck card it was false — a host presents weekly and deletes twice
a year — and the control that paid for the lie was `Delete`, sitting one pixel
from `Present` at the same size on every row.

> "Initially, show users only a few of the most important options. Offer a
> larger set of specialized options upon request … Progressive disclosure
> improves 3 of usability's 5 components: learnability, efficiency of use, and
> **error rate**."
> — [NN/g, Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)

The error-rate clause is the one that matters here, and [Hick's
Law](https://lawsofux.com/hicks-law/) ("the time it takes to make a decision
increases with the number and complexity of choices") multiplies it by the
length of the list.

**Test:** for every control on a screen, how often does the person who came
here use it? If "twice a year", it must not share a row and a size with the
one they came for. If it is also irreversible, it must not be one press.

### F6 — An ending is a junction, not a wall.
The last screen of a flow is the one people remember, and it is also the one
where the next thing begins. A final screen offering only "leave" treats an
ending as a full stop.

> "People judge an experience largely based on how they felt at its peak and
> at its end."
> — [Peak-End Rule](https://lawsofux.com/peak-end-rule/)

**Test:** at the last screen of any flow, write down the three things the
person most likely wants next. Is each of them one press away?

### F7 — Distance is measured in presses *plus scans*, and the hub is a home, not a toll booth.
A journey's cost is not its click count; it is clicks plus every list the
person must visually search on the way. "Three clicks" through two labelled
doors is cheap; two clicks with an unsearched hundred-row scan between them is
not — NN/g's own demolition of the three-click rule
([The 3-Click Rule for Navigation Is False](https://www.nngroup.com/articles/3-click-rule/))
is exactly this point: what predicts failure is not depth but **effort and
confidence per step**.

The structural failure this names is the hub bounce: a product whose global
destinations are reachable only from one page makes every cross-journey
`spoke → hub → scan → spoke`, and the hub's list is a toll paid even when
choosing from that list was never the point of the journey. The rule:

- **Global places are one press from everywhere.** If a destination appears in
  any page's header, it appears in every page's header — one shared shell, not
  N hand-rolled ones (this is `DESIGN.md` P1 applied to doors).
- **No journey passes through a list you must scan unless choosing from that
  list is the point of the journey.** Moving between two known documents is
  switching, not choosing; it gets a switcher or a typed jump, not a scroll.
- **Anything with a name can be reached by typing it.** A searchable list is
  the floor; a command palette is the ceiling and also the expert path
  (`FLOW.md` §3's own type-picker lesson: the filter pays the expert back).

**Test:** pick the five errands a host actually chains (edit A → edit B;
results → fix the question; templates → import; anywhere → present this
week's deck). Each must cost ≤ 2 presses with no unsearched scan between
them.

---

## 3. The journeys, before and after

Measured by driving the live app with Playwright — clicking what a person
clicks, never calling the API to get somewhere. (The previous five rounds of
automated QA drove the editor through the API and therefore never discovered
that editing a deck had no labelled affordance at all. A harness that takes
shortcuts cannot find the places where only shortcuts work.)

### Host, mid-session: fix a typo on the next slide
The worst journey in the product, and the one with a room watching.

| | Before | After |
|---|---|---|
| Named exits from the presenter view | **0** of 9 controls | `Edit deck`, first in the bar |
| Only non-destructive way out | browser Back — invisible in fullscreen, which is where a projector lives | a labelled button |
| Editor opens on | **slide 1**, scroll 0, every time | **the slide you left** |
| Recovery presses to get back to your slide | 1 scan + 1 press (more on a long deck) | 0 |
| Does the editor say the room is live? | no | yes — `You're presenting this deck — room 867991 is still open` |
| Can the host tell whether `Present` resumes or starts over? | no | the button says `Back to the room` |
| Round trip | 1 unlabelled press + 2 recovery + an unanswerable question | **2 presses, both labelled** |

Verified end to end: left at slide `2 / 6`, returned to `2 / 6`, same join
code, roster intact.

### Host, after the session
| | Before | After |
|---|---|---|
| Doors out of the final screen | **1** (`Back to dashboard`) | **4** |
| Presses to the CSV | 3 + scan an N-deck list — and `Export` had been on screen one press earlier | **1** |
| Presses to run the deck again | 2 + scan | **1** |
| Presses to open the deck | 2 + scan | **1** |

### Host, returning
`Edit` → work → `Present` → run → results. The editor now restores the slide
on every entry, not just the one from the presenter view; the `←` became
`← Decks`; and the wordmark in the header, which pointed at the *marketing
page* from every signed-in screen, now points at the deck list. Clicking a logo
should never log you out of the feeling of being inside the product.

Session history gained a trail — `Decks / <deck> / History` — because it is
reachable from two places and a single "back" cannot be right for both.
Previously its one control, `Back to decks`, threw a host who arrived from the
editor two levels up and left them to find their way back in.

### Host, mid-deck: go to slide 9 of 20
The presenter could only step ±1, and `presenter:next` is a **broadcast**.

| | Before | After |
|---|---|---|
| Presses | **8** | **1** (or `g`, then click) |
| Frames pushed to every phone in the room | **8** | **1** (measured) |
| Countdown restarts the room watches | 8 | 1 |
| Questions shown to the room on the way | 7 it was not meant to see yet | none |

The server has had `presenter:goto` since the beginning — `start()` uses it to
open the deck at index 0, and it runs the same validated nav chain as next/prev
including deleted-slide reconciliation. The transport was never missing; the
surface was. `slideTitles` was already on the session ack, unused.

**Where it lives, and why.** A jump target is a navigation surface and on this
product navigation surfaces are projected, so there are two questions: what
classification does it carry, and who gets to read it.

It renders inside the control bar's `<footer>`. That is not a convenience —
`DESIGN.md` §6 holds the floating bar to AA at desk distance rather than the
24px/7:1 stage floor, and the floor audit encodes that same boundary as
`el.closest("footer")`. A desk-distance panel anywhere else would mean either
lying to the audit or setting a slide list at 24px. If it ever moves out of
that footer it moves onto the stage ladder with it.

On who reads it: see the next section. The first version of this panel put
twelve questions on a projector, and "it leaks less than the eight slides you
would otherwise have presented" was true but was not a defence of leaking.

### Host, mid-deck: what the room may read off the navigator
The leak is precisely bounded, and the bound is the design: **you cannot spoil
a question the room has already been asked.** So a slide the room has been
shown carries its title, and a slide it has not carries its number and
`Not shown yet`.

That needs no configuration and no deck setting, and it is correct in the case
a cruder rule gets wrong. "Everything before the current slide" would have been
the obvious implementation and it leaks: a host who jumps 1→8 never showed 4
through 7, and those are still secrets. Measured on a ten-slide deck —

| Host does | Panel shows |
|---|---|
| Opens the lobby, nothing played | nothing — `10 not shown to the room yet` |
| Plays 1, 2, 3, then jumps to 8 | **exactly 1, 2, 3 and 8** — 4–7 skipped stay hidden, 9–10 ahead stay hidden |
| Presses `Show upcoming` | all ten, and the header says so plainly |
| Reloads the presenter | the preference holds, and so does what the room was shown |
| Opens the speaker window | all ten, always |

Jumping *forward* still needs a way to see where you are going, and on a single
screen this panel is the only thing that can say — so the host can reveal them,
from a control inside the panel where the need appears, and the choice persists
per host. **Off by default**: safe is a better default than familiar when the
cost of the wrong guess is a quiz night ruined, and the host who wants
look-ahead pays for it once. The header states the count rather than explaining
the rule — `6 not shown to the room yet` tells a host both why those cards are
blank and exactly what revealing them would cost.

What the room was shown survives a presenter reload, because the resume path
restores everything else about a live session and a refresh must not
re-classify twenty minutes of already-asked questions as secrets. It is
discarded, together with the titles, by the one staleness signal the presenter
already watches: when `totalSlides` stops matching the title array the deck
moved under us, every index below means something else, and a stale "seen"
would uncover a question nobody has been asked.

The titles are never stripped from the data — masking is a rendering decision
made by the surface being projected. That is why the same array feeds both
consumers and they disagree on purpose: the stage navigator honours `seen`, and
the speaker window ignores it.

**On the speaker window.** It is the right home and the wrong *only* home. It
needs a popup that can be blocked (`Present.tsx` already handles that case) and
a second display, and a navigation surface that exists only when a popup
succeeded is not a navigation surface. So the stage carries it always, and
`components/SpeakerWindow.ts` now carries the same list, clickable — a
dual-screen host never has to put the deck on the wall to find a slide.

Arrow keys are suppressed on the main handler while the panel is open. Without
that, browsing the map with the keyboard would have been driving the room:
`ArrowRight` there is `presenter:next`. Verified — the room's frame count does
not move while the navigator is open.

### Host, mid-session: the editor meets you where the room is
F3 and F4 genuinely disagreed here, and the tie is now broken toward F4 — with
an asymmetry that makes it the right call rather than a coin toss. A host
ducking out mid-session is almost always going to fix *what the room is looking
at*, and being dropped somewhere else costs them time in front of an audience.

The crumb the presenter already writes on adopt now carries the slide the room
is on — **by id, not index**, because an index does not survive the deck being
edited, which is the exact thing this host is about to do. A dead id is
self-describing; a stale index silently lands them on someone else's question.

The rule is *the room moving is news*:

| What happens | Where the editor opens |
|---|---|
| Prepare slide 6, present, room reaches slide 3, duck out | **slide 3** — what the room sees |
| Then pick slide 5 yourself, go to history, come back | **slide 5** — your choice stands; the room has not moved |
| Back to the room, advance to 4, duck out again | **slide 4** — the room moved, so it wins |
| Session ends | the marker and the band both disappear |

All four verified end to end. The rail also marks that slide `· on screen`, so
the host can see *why* it opened there and can still see where the room is
after they navigate elsewhere in the deck. That marker and the live band share
one verification — `LiveRoomBar` reports upward once the server has confirmed
the session — because two components independently deciding whether a room is
live is two answers to one question, and the one that skips the server check is
the one that will be wrong in front of a room.

### Host, presenting: the control bar
It had grown to twelve controls in one flat row, mixing four unrelated jobs —
driving the deck, running the room, configuring the host's own screen, and
ending the session — separated only by dividers, which is grouping *drawn on*
rather than grouping that exists. The slide jump would have made it thirteen.

The split is by **when**, not by category, because that is the question the
host's hand is asking. Back / Next / Slides / Scores / Q&A / Moderate are
touched throughout a session; speaker notes, room lighting, fullscreen, sound
and the CSV are touched once at the start or once at the end. Those five
collapse into one `More`.

| | Before | After |
|---|---|---|
| Controls in the bar | 12 | **8** (9 with Scores) |
| Bar width at 1920 | 1231px | **830px** |
| Slack at 1152 × 648 | would have clipped | **322px** |

The menu reads `noun → current value` (`Speaker notes · Closed`, `Sound · On`),
because a setting that does not say what it is set to answers "what can I
change" and not "what is it now". Toggles keep the menu open — flipping sound
and then the lighting is one errand — while actions close it, because they have
taken you somewhere. It opens upward, since downward from a bar pinned to the
bottom of the viewport is off-screen.

Two naming consequences, both resolved by deleting rather than duplicating.
`Export` became `Download results`, which is what the final-results screen and
the deck list already call the same file. And the lighting row is named for the
setting (`Room lighting · Dim`) rather than the action: as a bar button
"Bright room" was right, because a button says what pressing it does, but in a
menu of `noun → value` rows an action label beside a value fights itself —
"Bright room … Dim" reads as two claims about one row.

### Host, first run
| | Before | After |
|---|---|---|
| The empty pane said | *"Select or add a slide to edit it"* | *"Let's build your first slide"* + the three likeliest, the first one recommended by name |
| Choices in the rail, always | **17**, flat, three headings, no recommendation | **1** — `+ Add slide` |
| Presses to a first slide | 1 (after scanning 17) | **1** |
| Each type's one-line hint | written, but hidden in a `title` attribute | visible on every card |
| Expert path | scan 17 inline | `+ Add slide`, type three letters, Enter |

Hiding a catalogue taxes the person who already knows what they want, and that
is the person using it most — so the picker opens focused on a filter. "rank" +
Enter adds a Ranking slide. The expert comes out ahead rather than taxed.

### Host, after the session — one screen later
The four doors on the final screen vanish the moment the host takes one of
them, and the CSV is usually wanted a minute *later*, once they have sat down.

| | Before | After |
|---|---|---|
| Presses to the CSV from the deck list | 3 + a scan of every deck you own (104 rows on the test account) | **1** |
| How | find the deck, `•••`, Session history, Download | `You just ran <deck> — Download results` |

There is no bulk "recent sessions" endpoint and the server is not ours to
change, so asking the API which deck ran last would be one request per deck.
The host's own browser already knows — it was driving the session — so the
answer is remembered rather than re-derived, and the band still links to the
real authenticated endpoint rather than trusting anything cached.

### Player
| | Before | After |
|---|---|---|
| Join | code, `Join`, nickname, `Join the game` — 4 taps, 2 of them typing | unchanged; it is already minimal |
| Controls on the podium | **0** | `Join another game` |
| Getting to the next game | find the address bar on a phone, or press browser Back | one tap |
| Reload after the podium | returns to a game they already finished | the seat is released, so it doesn't |
| Which room am I in? | nothing on the phone to check against — a single mistyped digit lands you in a real but wrong session | the lobby echoes `Room 157770` |
| How far through is this? | nothing (host-paced decks) | `5 of 8` in the header |

The position counter is status, not mirrored content: `DESIGN.md` rejects
echoing the big screen onto the phone, and this echoes nothing the big screen
says. It appears on host-paced decks only — a self-paced deck already carries
the same counter in its own nav bar, and two spellings of one fact is the
defect P1 exists to prevent.

### The deck list
6 controls per row → **4** (`title`, `Edit`, `Present`, `•••`), with
`Session history`, `Duplicate` and `Delete deck` one layer in. On a
twenty-deck list that is 120 targets reduced to 80, and the irreversible one
is no longer adjacent to the one you came for.

### One interaction, four popups
The slide navigator had arrow-key navigation and the three other popups did
not, which is P1 at the level of behaviour: two spellings of one interaction.
Adding a second and third hand-rolled key handler would have been the obvious
move and would have guaranteed drift — the kind nobody notices, because nobody
discovers that Home works in one menu and not another until they need it.

So the logic came out into `lib/arrowFocus.ts` and all four adopted it. It is
a floor as much as a consistency argument: ARIA's menu pattern specifies arrow
navigation for `role="menu"`, and a menu you can only Tab through is not a menu
to anyone not using a mouse, whatever it looks like.

Geometry decides the column count rather than a prop, so the same hook serves a
vertical menu and a reflowing card grid without being told which it is — and
the question is asked of the DOM when the key is pressed, so a grid that
reflows at a narrower width keeps working. Measured across all four:

| | Navigator (4-col grid) | Presenter `More` | Deck row `•••` | Type picker |
|---|---|---|---|---|
| Arrows move focus | ✓ (Down crosses a row: 1 → 5) | ✓ | ✓ | ✓ |
| `Home` / `End` | ✓ | ✓ | ✓ | ✓ |
| `Escape` closes | ✓ | ✓ + focus back on trigger | ✓ + focus back on trigger | ✓ |
| `Down` on a closed trigger opens *and* enters | — | ✓ | ✓ | — |
| `Enter` commits | ✓ jumps | ✓ | ✓ | ✓ adds the slide |

The one place the hook has to know where it is standing: in a text field,
Left/Right belong to the caret. The type picker's filter box keeps them —
verified, the caret moves and focus stays — and `Down` is the way out of the
box and into the cards.

### Every return to a list
`HashRouter` has no scroll restoration, and the browser's own is defeated by a
client-rendered list that does not exist yet when the restore would fire. The
deck list, the template gallery and a deck's history all scrolled back to the
top on every return. On a host with eighty decks that is a scan and a scroll
to reach the row they were looking at four seconds earlier, paid on every
navigation. Measured: 1400px → 0 before, 1400px → 1400px after.

One exception, and it is the point rather than a carve-out: the restore is
suppressed when a band at the top has something to say. A host who has just
ended a session lands on the deck list with "You just ran …" on it — and was
being scrolled eleven hundred pixels past it, to the row they happened to be
looking at before they presented. **Arriving with news is not the same arrival
as returning.**

### The editor's form pane
The last place in the product that forgot where you were. The rail remembered
which slide you were on and every list remembered its scroll, but coming back
to a long slide form put you at the top of it. A half-kept promise is worse
than an unmade one, because it teaches people the product remembers and then
catches them out.

Keyed per slide rather than per pane, which also makes moving *between* slides
behave: a slide you have never opened starts at the top, and one you have
returns to where you were. A pane-level memory would have got both backwards —
dropping you into the middle of a form you have never read. Verified: unvisited
slide opens at 0, revisited slide returns to 356, and it survives leaving the
editor entirely and a full reload.

### Export a deck
`/transfer` was two tasks wearing one page, and reading it properly changed the
plan (§5). The import half is a scoped task. The export half was **a second
copy of the deck list** — you left the deck list, found the same deck again in
another list one navigation away, and pressed Download beside it.

| | Before | After |
|---|---|---|
| Presses | 2 | 2 |
| Lists to scan | **two** | one — the one you were already looking at |
| Page changes | 1 | 0 |
| `DeckTransfer.tsx` | 361 lines | **231** |

The press count is unchanged and that is not the point: a whole screen existed
as a synonym for a row you were already on. Export is a per-deck verb, so it
lives on the deck, in its `•••` menu, and `lib/deckFile.ts` is the single
implementation. The page it left is now titled `Import a deck`, does one thing,
and says where the other verb went.

### Player, self-paced: a clock they can now see
The server changed underneath this: in audience pacing each player now has
their own clock, stamped when they arrive at a slide, and is scored against it.
A countdown therefore has to appear where there was none — scoring someone on a
clock they cannot see is indefensible.

The wiring had one half connected. `participant:goto` reported both `startedAt`
and a **scaled** `timeLimitSec`; only the first was read, so the ring fell
through to `currentSlide.config.timeLimitSec`, the raw authored value. The same
hole existed on the other path: `slide:changed` was deliberately nulling both
for self-paced decks, on a premise that had just stopped being true.

That is worse than a cosmetic mismatch. The scaling is `timeScale`, the relaxed
timing setting that exists for dyslexic and ADHD players, so the ring lied
hardest to exactly the people the setting protects. Proven at the socket level
on a deck with `timeScale: 2` — raw 10s, real window 20s:

| | |
|---|---|
| Answer at T+0 | accepted, **980** pts |
| Answer at T+14 — past the raw limit, inside the real one | accepted, **629** pts |
| What the ring showed before the fix | `10`, reaching zero with **6s still to play** |

Both paths now take the server's number. The server's own comment says why:
*"The client must not re-derive this from config or the ring and the auto-reveal
disagree."*

### Player, self-paced: two things the ring exposed
A countdown had never been seen in this context, and putting one there made two
existing behaviours legible.

**Walking back to a question you already answered handed you a fresh one.**
`participant:goto` cleared `answered`/`myAnswer` unconditionally, so stepping
back in a self-paced deck re-armed four tappable tiles over an answer the
server had already scored — and `participant:submit` upserts, so one tap
replaced a 927-point answer with a late, cheap one. It was always wrong and
always silent; the countdown turned it into an active invitation. The join ack
reports `answered` for the slide you land on and the `goto` ack reports it for
nothing, so this tab is the only thing that knows — it now remembers what it
submitted, and what reveal it already watched, per slide. Verified: the
revisited slide shows their own result, no ring, and a tap on a different tile
leaves the score at 927 with the server agreeing.

**Zero means two different things, and which one depends on how you got there.**
Measured: on the slide the host seats everyone on, the shared auto-reveal is
armed and zero really is a deadline — *"Time's up. You didn't answer in time."*
On a slide the player walked to themselves no timer is armed at all; the phone
receives no event, the tiles stay live, and a correct answer still scores
exactly `MIN_POINTS`. The same ring, spending its last three seconds pulsing
rose, about a consequence that in half the cases never arrives.

The ring is retired at zero and replaced by a line that says what zero cost —
`Speed bonus used up — your answer still counts` — on self-navigated slides
only, because on host-seated ones the reveal says the truer thing. Verified
end to end: answering after the line appears scores exactly 500, which is the
arithmetic the copy claims, and host-paced decks are untouched.

### Deleting something, with a way back
Both deletions were guarded by `window.confirm()`. NN/g are blunt about which
way round this belongs: a confirmation taxes every correct action to catch the
rare wrong one; an undo taxes none of them and catches all of them. The old
dialog said *"This cannot be undone"* — true, and the reason it was the wrong
design.

There is no restore endpoint and rebuilding a deck from whatever the client
still held would be a different deck, so the undo is real rather than
compensating: **the destroy is deferred.** The row leaves the screen at once;
the irreversible request waits six seconds; undo inside that window means the
server is never told.

The window is the whole design, so both ways of leaving it early are handled —
unmount and `pagehide` (not `beforeunload`, which does not fire on mobile
Safari's bfcache path) — or this would trade a confirm for a far worse bug: an
item that returns from the dead on the next load. Verified: undo keeps the
deck, elapsing deletes it, navigating away 0.4s in still commits, and the
slide case restores the rail to three with the rescued slide re-selected. Zero
native dialogs remain in the product.

### Signed-out deep links
`/edit/<id>` while logged out used to bounce to `/login` and then land on the
dashboard — the destination was discarded at the gate. A shared link, a
bookmark, or a token that expired mid-edit all ended in the wrong room. The
gate now carries the destination and login hands it back (in-app paths only;
`//host` is rejected, because "log in and get sent somewhere else" is an open
redirect).

---

## 4. What was built

| File | What it does |
|---|---|
| `client/src/lib/liveSession.ts` | The breadcrumb. The presenter writes it on **adopt**, not on exit, so every uncontrolled exit — browser Back, a reload, a bookmark, another tab — leaves a trail. `sessionStorage`, so it belongs to this tab's visit. |
| `client/src/components/LiveRoomBar.tsx` | "Your room is still open," on the editor and the deck list, with the code and one door. Never trusts the crumb: re-checks with the server that a session with that code is still `LOBBY`/`ACTIVE`. A banner pointing at a dead room is worse than no banner. |
| `client/src/components/MoreMenu.tsx` | The occasional actions, one layer in. Hand-rolled rather than `<details>` because a native disclosure doesn't close on Escape, doesn't close on an outside click, and doesn't return focus to its trigger. |
| `presenter/Present.tsx` | `Edit deck` as the first control in the bar; two-press `End`; four doors on the final screen. |
| `presenter/Editor.tsx` | Remembers the selected slide per deck; `← Decks`; hosts the live-room bar. |
| `presenter/Dashboard.tsx` | Two verbs per row plus `•••`; hosts the live-room bar, named. |
| `presenter/History.tsx` | Breadcrumb; a `Present` button, because the commonest reason to look at a deck's history is to run it again. |
| `participant/Play.tsx` | A door off the podium, which also releases the seat. |
| `App.tsx` + `presenter/Login.tsx` | The gate carries the destination. |
| `components/SlideNavigator.tsx` | Go to any slide, in one broadcast. Lives in the control bar's `<footer>` so its desk-distance classification is structural rather than an exception. |
| `components/SlideTypePicker.tsx` | The seventeen types, behind one press, grouped, with every hint visible and a filter so the expert path is faster than before. |
| `components/LastRunBar.tsx` | The session you just finished, one press from its CSV. |
| `lib/scrollMemory.ts` | Lists come back to where you left them — and deliberately do not when the page has news. |
| `components/SpeakerWindow.ts` | Carries the same slide list, clickable, on the one surface a projector never shows. |
| `components/MoreMenu.tsx` | Grew `placement`, `size`, per-row `detail` and `menuitemcheckbox` so one disclosure mechanism serves both a dense list row and the presenter's bar. |
| `lib/arrowFocus.ts` | One keyboard implementation for all four popups, replacing one real handler and three absences. |
| `lib/deckFile.ts` | Exporting a deck to a file, as one operation rather than a page. |
| `lib/scrollMemory.ts` | Gained `usePaneScrollMemory` for a scrolling element keyed per item, alongside the window-level hook. |
| `lib/undoDelete.ts` + `components/UndoBar.tsx` | Deferred destroy with a real undo, replacing both `confirm()` dialogs. |
| `lib/presenterPrefs.ts` | Host-machine preferences (localStorage, like the stage theme) and what the current room has been shown (sessionStorage, keyed by join code). |
| ~~`components/ui/SoundToggle.tsx`~~ | **Deleted.** Its logic moved into the presenter's settings menu, which was the only place it was used. "A future participant view might want it" is how a codebase fills with well-built orphans; git has it if we were wrong. |

**`End` is now two presses.** It is irreversible, it ejects every phone in the
room, and it sat in a row of identically-sized ghost buttons one pixel from
`Export`. The confirmation is inline rather than `window.confirm()` for two
reasons specific to this surface: a native dialog drops some engines out of
fullscreen, flashing the desktop at the room, and it renders at OS size, which
is not a size this stage controls. It disarms after four seconds — a
confirmation left armed is its own trap, because a host who walked away and
came back would press "Sure?" believing it to be the first press.

**A bug the screenshots found, which no audit could have.** The navigator's
scrim was in the right place, the right size and the right z-index, and
completely invisible — `bg-canvas/80` computes to `rgba(0, 0, 0, 0)`. Grepping
the pattern found **four more**, all wrong since the day they were written.
The mechanism, and the rule that replaces it, now live in **`DESIGN.md` §4**,
next to the colour ladder, because that is where someone reaching for a
translucent surface will be standing. It is recorded there rather than here
because it is a property of the colour system, not of the flow — and because
the failure is silent in every channel we have: invisible in a diff, to the
type checker, and to `lint:design`, and at runtime it looks like a
stacking-context bug rather than a colour one.

Constraints held: `npx tsc -p tsconfig.app.json --noEmit` and
`npm run lint:design` clean; the overshoot budget is still exactly three
moments (`grep -rn "spring.pop\|animate-pop-in" src`); no inline spring
literals; `prefers-reduced-motion` verified on the new menu (settles at
`opacity 1`, `transform: none`); the presenter's `resume-session`-before-
`create-session` path verified intact across a host reload (`2 / 6` → `2 / 6`,
roster intact, and again with the navigator shipped); the control bar at 12
controls fits 1280 × 720 with 102px to spare and wraps rather than clips below
that; `prefers-reduced-motion` verified on the navigator and the type picker
(both settle at `opacity 1`, `transform: none`); the jump verified against a
real phone in the room at **1 broadcast, not 8**, with the room's frame count
unmoved while the panel is open and no answer-key string anywhere in it; the
full 24px stage-floor audit clean (`stage text below 24px: 0`) across lobby,
question and navigator-open.

---

## 5. Explicitly rejected

| Rejected | Why |
|---|---|
| A confirmation dialog on `End` | Native modals leave fullscreen on some engines and render at a size the stage does not control. The destructive press is guarded in place instead. |
| Auto-navigating the host on socket events (to results, to the podium) | "Never force someone to change tabs automatically" — [WWDC22](https://developer.apple.com/videos/play/wwdc2022/10001/). The room is the host's instrument; the product does not grab it. |
| Making the presenter view a modal over the editor | A modal is for a *self-contained* task: "someone has enough information in that view to make decisions and complete a task." Presenting is the opposite — it is the thing you leave and re-enter, and WWDC22's own rule is that frequent toggling means push, not modal. |
| Keeping the slide-advance `←` and adding a deck-exit `←` | Two journeys, one glyph. `DESIGN.md` P1: delete the synonym. The exit is spelled `Edit deck`. |
| Breadcrumbs everywhere | They earn their place where a screen has two parents (session history). On a two-level hierarchy they are chrome restating the obvious. NN/g: breadcrumbs show *hierarchy*, not session history — the places that only have one parent get a named back control instead. |
| A global persistent nav / tab bar | There are two audiences and three modes; a tab bar implies peer categories that can be switched between freely, and "the editor" and "a live room with 28 phones in it" are not peers. |
| Optimising for click count | "The 3-click rule is an arbitrary rule of thumb that is not backed by data," and click counting "does not take into account cognitive factors … [or] figure out where they currently are in the site's structure" — [NN/g](https://www.nngroup.com/articles/3-click-rule/). The counts in §3 are evidence of *missing doors*, not a target. |
| Mirroring the deck position onto the player's phone | `DESIGN.md` already rejected mirroring question text: the phone is a controller and attention belongs on the shared screen. A progress counter is status rather than content, so it is arguable — and therefore deferred to §6 rather than smuggled in here. |
| Putting the slide navigator **only** in the speaker window | It is the Keynote-correct home and the wrong *only* home: it needs a popup that can be blocked and a second display. A navigation surface that exists only when a popup succeeded is not a navigation surface. It is in both. |
| Converting `/templates` to a sheet | A sheet is for "a scoped task closely related to the current context"; the template gallery is other people's decks, with its own loading state, empty state and content. That is a **destination**, not a task — Apple's own App Store puts browse behind a tab, not a sheet. |
| Converting `/transfer` to a sheet | **A correction to this table.** It previously said `/transfer` "is the one that is genuinely sheet-shaped", asserted from the citation rather than from the file. Reading it, the page was two tasks: an import (sheet-shaped, yes) and an export that was a second copy of the deck list. Putting *that* in a sheet would have floated a duplicate deck list over the real one. The duplicate is deleted and export now lives on the deck row (§3); what remains is a small single-purpose import page. Making it a sheet would mean a third hand-rolled modal shell, in the same batch that deleted duplicated interaction code rather than adding it — extracting a shared `Sheet` is the prerequisite, and it wants a second genuine customer to be designed against. |
| A deck setting for the navigator's masking | It would have to be stored, and deck fields are the server's. It is also the wrong shape: the right rule needs no setting, because "has the room seen this" is a fact the presenter already knows rather than a preference anyone should have to express. |
| "Everything before the current slide" as the seen rule | The obvious implementation, and it leaks. A host who jumps 1→8 never showed 4 through 7, and a rule based on position rather than history would have revealed them. |
| Moving the live-session breadcrumb to localStorage | It would let a host see the live band in a *second tab*, and it would cost correctness to do it. Two tabs presenting two different decks share one localStorage, so the editor in tab one would offer "Back to the room" pointing at tab two's room. Measured, the current failure is benign: a second tab shows no band, no marker, a fully usable editor and zero errors — it degrades to exactly the behaviour that existed before any of this was built. **Silent absence is an acceptable failure; confident wrongness in front of an audience is not.** A durable fix wants the server to answer "is anything live for me", which it has no endpoint for. |
| Stepping to a jumped slide, or confirming a jump | The press is reversible — `Back` returns, and a jump is one broadcast either way. A confirmation on a reversible navigation is the trap F2 warns about pointed the other way. |
| Undo instead of confirm for deck/slide deletion | The right answer, and NN/g prefer it. It needs a server-side tombstone, and `server/` is out of scope for this pass. Recorded in §6 rather than half-built. |
| Pushing the successor session's code onto the previous room's phones | Investigated after a QA blocker whose reporter wrote the line "the most ordinary thing a host does with a quiz deck is run it twice", on the hypothesis that the player's half of a replay was a wall. **It is not, and the hypothesis was wrong in both of its parts.** The nickname is stored separately from the seat (`menti_nickname`, read back as the `name` default), so `Join another game` clears the seat and keeps the name — nobody retypes who they are. And the moment a host presses `Present again` the stage returns to the LOBBY, which is the one view that renders the join code at `text-stage-code` — so the code a player needs is on the wall, at full size, at exactly the moment they need it. What remained was a push that would save reading six digits off a screen already showing them, at the cost of a new socket event, a cross-session link between a dead room and a live one, and a decision about what to do when the host's second deck is a different deck. Recognition already beats recall here without the product doing anything. |

---

## 6. What is still wrong

Counting honestly, because this document's standard is that a system wrong
about itself cannot be trusted about anything else.

**All ten of the first pass's findings are now fixed**, the last of them —
`confirm()` → undo — in this batch. Four later items were settled by deciding
against them rather than by building: the live crumb's tab scope, a deck
setting for navigator masking, `/transfer` as a sheet, and the sheet-shaped
half of that page. All four are in §5 with their reasoning, one of them a
correction to what this document previously claimed.

Two items are **blocked on `server/`, and were re-checked against the code
this batch rather than carried forward on trust** — `server/` changed
substantially (config validation, `timeScale` transfer, a per-socket
`session:ended`), and neither of these moved:

1. **`slideTitles` is still issued once and never re-pushed.** Confirmed by
   reading the handler: it is emitted on `create-session` and `resume-session`
   only, and `slide:changed` does not carry it. A slide added or deleted
   mid-session invalidates the list; the client notices (the authoritative
   `totalSlides` stops matching) and discards both the titles and the
   shown-slides set together, re-learning a title each time the host lands on
   a slide. Honest, and still a client working around a protocol gap.
2. **The reveal preference is per host, not per deck.** Confirmed against
   `schema.prisma`: `Presentation` has no column for it, so there is nowhere to
   put a per-deck answer. A host running a trivia night and a staff all-hands
   from one account gets one setting for both.

A third was a **server design question rather than a client gap**. It has
since been answered, and is recorded here because the reasoning outlived it:

3. **A self-paced countdown meant two different things — RESOLVED.** On the
   slide the host seated everyone on, the shared auto-reveal was armed and zero
   closed the question; on a slide the player walked to themselves nothing was
   armed and the question stayed answerable for half marks. The asymmetry was
   in the model, so it was decided there rather than patched here: **audience
   pacing no longer auto-reveals at all** (`armRevealTimer` returns early for
   self-paced decks). A reveal is one room-wide frame, and a deck where
   everyone is on a different slide has no shared moment to fire it at — it was
   landing on whoever happened to still be reading, closing the question
   against them and pre-spoiling it for anyone who had not arrived yet. That
   punished the slowest reader, which is the axis relaxed timing exists to
   protect.

   The client consequence: the honest zero-state copy keys on the deck's
   PACING, not on how the player reached the slide, because the deck's mode is
   what decides whether zero closes anything. Host-paced decks are unchanged
   and still genuinely close.

   Known follow-up — **now closed, and it was worse than this paragraph
   claimed.** The follow-up was written as "no feedback until the host ends the
   session". Measured, it was no feedback *ever*: every result on the phone was
   gated on a room-wide `reveal`, and a self-paced deck has no reliable source
   for one, so the card sat on "Hold tight — answer coming up." for the rest of
   the session. `FeedbackCard` now resolves into the player's own result under
   AUDIENCE pacing, built from the submit ack the phone already held. The
   PRESENTER path is byte-for-byte unchanged. Measured after: self-paced reads
   `Correct +976 · rank #1` at t=2.5s and survives a reload; host-paced still
   reads "Hold tight" at t=10s and resolves only when the server reveals.

   It shows the player's own result and never the answer key — that is still
   the reveal's to give, in both pacings.

A fourth was found by applying F3's own test to a screen that had never been
given it, and is **fixed in this batch**:

4. **A reload on your own podium erased it — RESOLVED.** F3's test is "open a
   screen, change its state, navigate away, come back, diff." Nobody had run it
   on the ending, because the ending did not look like a place you could leave
   and return to. It is: the seat survives, and a phone reloads for a hundred
   reasons. Measured — a player who finished 4th on 955 read
   `#2 Bot1 / Bot0 WINNER / #3 Bot2 / YOU FINISHED #4 955 points`, reloaded,
   and read **`That's a wrap`** over an empty screen. The whole result was
   gone: board, rank and score.

   The cause is a seam, not a bug in either half. The podium is normally built
   by the `session:ended` event, but a reload does not replay events — it
   re-joins, and the server *refuses* that join with `SESSION_ENDED`. The
   client already turned that refusal into the ending rather than an error
   (which is why the screen said "That's a wrap" at all); the refusal simply
   carried nothing to put under the words.

   It now carries the same public board and the same two per-socket scalars
   `session:ended` stamps. Deliberately the public board and not the full one:
   every row carries a `participantId`, and a `participantId` is the whole of
   what `participant:join` needs to take that seat — a refusal from that very
   handler is the last place to widen it. Measured after: the screen is
   byte-identical across the reload.

What is left that is ours, in the order it costs a person something.

5. **`LastRunBar` only knows about runs that ended in this tab.** Close the
   browser and the pointer to your last session is gone — the results are still
   in `Session history`, two presses away. A durable answer needs a "recent
   sessions" endpoint that does not exist.
6. **Walking past a slide silently spends its clock.** Measured: a player who
   arrives at a slide, moves on, browses for seven seconds and comes back
   scores 562 where someone who answered on arrival scored 1000 — the clock ran
   the whole time, because first arrival wins. The ring is now honest about it
   *on return*, but nothing warns you on the way past. Arguably correct
   (stepping away must not reopen the window) and arguably a trap; it needs a
   decision about what audience pacing is for.
7. **The deck title is still an unlabelled drill-in.** Now redundant rather
   than load-bearing — `Edit` sits beside it — so a consistency wrinkle rather
   than a trap. It stays listed because the original defect in this product was
   exactly this affordance being the *only* way in, and a system that forgets
   its own near-misses re-earns them.
8. **The type picker has no "recently used".** The filter pays back most of
   what progressive disclosure costs an expert, but an author building a
   twelve-question quiz types the same three letters twelve times.
9. **There is no shared `Sheet`.** Two modal surfaces each own a scrim, a panel
   and a dismiss. `lib/arrowFocus.ts` took the keyboard half out; the
   presentation half is still duplicated, and it is the prerequisite for the
   `/transfer` decision in §5 rather than a separate task.
10. **`MoreMenu` has no typeahead.** Arrows, `Home`, `End` and `Escape` all work,
   but ARIA's menu pattern also specifies jumping to an item by first letter.
   Low cost on a three-row menu; worth it if a menu ever gets long.

## 7. Sources

Primary, and quoted rather than paraphrased. Two sourcing notes, because a
philosophy that is wrong about its own citations cannot be trusted about
anything else: Apple's **Navigation** page and the **clarity / deference /
depth** themes no longer exist at live HIG URLs and are cited from the
archived iOS HIG; and Parnin & Rugaber's often-quoted "15–30 minutes to
rebuild context" is paywalled and therefore **not** cited here.

**Apple**
- [Navigation (archived iOS HIG)](https://developer.apple.com/design/human-interface-guidelines/ios/app-architecture/navigation/) — the three navigation styles; "always provide a clear path"; "in general, give people one path to each screen."
- [Modality](https://developer.apple.com/design/human-interface-guidelines/modality) — "present content modally only when there's a clear benefit"; "always give people an obvious way to dismiss a modal view."
- [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) — "a sheet helps people perform a scoped task that's closely related to their current context."
- [Themes (archived iOS HIG)](https://developer.apple.com/design/human-interface-guidelines/ios/overview/themes/) — depth: "transitions provide a sense of depth as you navigate through content"; user control: "confirming destructive actions, and making it easy to cancel operations."
- [WWDC22 — Explore navigation design for iOS](https://developer.apple.com/videos/play/wwdc2022/10001/) — push vs. modal; "modals create focus by separating people from the information hierarchy"; "never force someone to change tabs automatically."

**Nielsen Norman Group**
- [User Control and Freedom](https://www.nngroup.com/articles/user-control-and-freedom/) · [Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/) · [Recognition Rather Than Recall](https://www.nngroup.com/articles/recognition-and-recall/) · [Consistency and Standards](https://www.nngroup.com/articles/consistency-and-standards/)
- [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [The 3-Click Rule for Navigation Is False](https://www.nngroup.com/articles/3-click-rule/) · [Breadcrumbs](https://www.nngroup.com/articles/breadcrumbs/)
- [Serial Task Switching](https://www.nngroup.com/articles/serial-task-switching/) — "each time we switch tasks, the brain must reset and reacquire the context."
- [Mobile UX](https://www.nngroup.com/articles/mobile-ux/) · [Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/) — 1s is the limit for uninterrupted flow of thought; past 10s, "assume that users will need to reorient themselves."

**Laws of UX** — [Jakob's](https://lawsofux.com/jakobs-law/) · [Hick's](https://lawsofux.com/hicks-law/) · [Fitts's](https://lawsofux.com/fittss-law/) · [Peak-End](https://lawsofux.com/peak-end-rule/) · [Doherty Threshold](https://lawsofux.com/doherty-threshold/). [Miller's Law](https://lawsofux.com/millers-law/) is deliberately *not* used: its own page warns against citing "seven items" to justify design limits, and nothing here needs it.

**Primary research** — Mark, Gudith & Klocke, [*The Cost of Interrupted Work: More Speed and Stress*](https://interruptions.net/literature/Mark-CHI08.pdf), CHI 2008.
