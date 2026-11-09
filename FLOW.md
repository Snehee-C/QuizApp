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

## 2. The six principles

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

On who reads it: yes, the room can see the upcoming questions while it is open.
That cost is real and it is the smaller one — the behaviour it replaces showed
the room those same questions as full-screen slides, one after another, with
the clock running on each. A two-second glance at a dimmed, truncated list is
strictly less leakage than actually presenting them. It is host-initiated, it
dismisses on Escape, on an outside click and on the jump itself, and the stage
behind it is scrimmed so the room reads "the host is choosing", not "here is
the deck". No config, no options and no correct answers are routed into the
component.

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
| Converting `/templates` to a sheet | On reflection this citation was applied too broadly when it was written. A sheet is for "a scoped task closely related to the current context"; the template gallery is other people's decks, with its own loading state, empty state and content. That is a **destination**, not a task — Apple's own App Store puts browse behind a tab, not a sheet. `/transfer` is the one that is genuinely sheet-shaped, and it is still queued (§6). The measurable harm both pages caused was losing the deck list's scroll position, and that is fixed for every page rather than for two. |
| Stepping to a jumped slide, or confirming a jump | The press is reversible — `Back` returns, and a jump is one broadcast either way. A confirmation on a reversible navigation is the trap F2 warns about pointed the other way. |
| Undo instead of confirm for deck/slide deletion | The right answer, and NN/g prefer it. It needs a server-side tombstone, and `server/` is out of scope for this pass. Recorded in §6 rather than half-built. |

---

## 6. What is still wrong

Counting honestly, because this document's standard is that a system wrong
about itself cannot be trusted about anything else. Of the first pass's ten
findings: **six are fully fixed** (the seventeen-type wall, ±1 stepping, the
control bar, the player's position, the lobby code echo, and the run that just
happened), **one is partly fixed** (the page-swap complaint — scroll survives
every return now, `/transfer` is still a page), and **three remain** (deletion
confirms, the editor pane's scroll, the deck-title drill-in). The second pass's
open question — where the editor opens when you duck out of a live room — is
settled in §3. What is left, in the order it costs a person something.

1. **`confirm()` still guards both deletions.** A native modal with no undo,
   for an irreversible act. F5 is half-satisfied: `Delete deck` moved a layer
   into the `•••` menu, but it is still confirm-then-destroy rather than
   destroy-then-undo, which is what NN/g actually recommend and what the
   product should do. It needs a server-side tombstone, and `server/` is out of
   scope.
2. **The stage navigator shows upcoming questions to the room.** Argued in §3
   as the smaller of two leaks, and it is — but "smaller" is not "none". A
   trivia host running a paid quiz night has a real objection. The unbuilt
   better answer is a numbers-and-type-only mode for the stage panel, with full
   titles reserved for the speaker window, chosen once in deck settings rather
   than guessed at per press.
3. **`slideTitles` is issued once and never re-pushed.** A slide added or
   deleted mid-session invalidates the list; the client notices (the
   authoritative `totalSlides` stops matching) and degrades to numbers,
   re-learning a title each time the host lands on a slide. Honest, but it is a
   client working around a protocol gap — the real fix is the server re-issuing
   titles on `slide:changed`, which is not ours to write.
4. **Every live-session memory is tab-scoped.** The breadcrumb is
   `sessionStorage`, deliberately — a crumb that outlives its tab greets a host
   on Monday with a room that died on Friday. The cost is that a host who opens
   the editor in a *second tab* gets neither the live band nor the `on screen`
   marker, and the editor will not follow the room. The marker makes a
   limitation that was always there easier to notice. A durable fix needs the
   server to answer "is anything live for me", which it has no endpoint for.
5. **The editor restores selection but not scroll.** Come back to a long slide
   form and you are at the top of it. F3 is satisfied for the rail and for every
   list in the product, and not for that one pane.
6. **`/transfer` should be a sheet.** Import and export is a genuinely
   self-contained task — file in, file out — and it is a full page swap with its
   own header. Now that scroll survives the round trip the remaining cost is
   structural rather than measurable, which is why it is listed rather than done
   on the way past. (`/templates` is a destination, not a task — §5.)
7. **Neither menu has arrow-key navigation between items.** `MoreMenu` opens,
   closes on Escape and on an outside click, and returns focus to its trigger,
   but moving between rows is Tab, not Down — and it is now the presenter's
   settings cluster, not just a row overflow. `SlideNavigator` does implement
   arrow movement; the menus should match it, and so should the type picker,
   where only "filter, then Enter for the first match" is wired.
8. **`LastRunBar` only knows about runs that ended in this tab.** Close the
   browser and the pointer to your last session is gone — the results are still
   in `Session history`, three presses away, which is where everyone was before.
   A durable answer needs a "recent sessions" endpoint that does not exist.
9. **`components/ui/SoundToggle.tsx` is now unreferenced.** Its logic moved
   into the presenter's settings menu, which was the only place it was used.
   P1 says delete the weaker mechanism rather than leave it lying about, but it
   is a well-built accessible toggle and the participant view may want it, so
   the call is flagged rather than taken. It is dead code either way until
   someone decides.
10. **The deck title is still an unlabelled drill-in.** Now redundant rather
    than load-bearing — `Edit` sits beside it — so a consistency wrinkle rather
    than a trap. It stays listed because the original defect in this product was
    exactly this affordance being the *only* way in, and a system that forgets
    its own near-misses re-earns them.
11. **The type picker has no "recently used".** The filter pays back most of
    what progressive disclosure costs an expert, but an author building a
    twelve-question quiz types the same three letters twelve times. Remembering
    the last type used in this deck would make the common case one press again.

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
