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

### Host, first run
`New deck` → editor → `+ Multiple choice` → type → `Present`. Three presses,
unchanged. The cost here was never steps: it is that the empty editor says
*"Select or add a slide to edit it"* beside **seventeen** equally-weighted
slide types and recommends none of them. Not fixed — §6.

### Player
| | Before | After |
|---|---|---|
| Join | code, `Join`, nickname, `Join the game` — 4 taps, 2 of them typing | unchanged; it is already minimal |
| Controls on the podium | **0** | `Join another game` |
| Getting to the next game | find the address bar on a phone, or press browser Back | one tap |
| Reload after the podium | returns to a game they already finished | the seat is released, so it doesn't |

### The deck list
6 controls per row → **4** (`title`, `Edit`, `Present`, `•••`), with
`Session history`, `Duplicate` and `Delete deck` one layer in. On a
twenty-deck list that is 120 targets reduced to 80, and the irreversible one
is no longer adjacent to the one you came for.

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

**`End` is now two presses.** It is irreversible, it ejects every phone in the
room, and it sat in a row of identically-sized ghost buttons one pixel from
`Export`. The confirmation is inline rather than `window.confirm()` for two
reasons specific to this surface: a native dialog drops some engines out of
fullscreen, flashing the desktop at the room, and it renders at OS size, which
is not a size this stage controls. It disarms after four seconds — a
confirmation left armed is its own trap, because a host who walked away and
came back would press "Sure?" believing it to be the first press.

Constraints held: `npx tsc -p tsconfig.app.json --noEmit` and
`npm run lint:design` clean; the overshoot budget is still exactly three
moments (`grep -rn "spring.pop\|animate-pop-in" src`); no inline spring
literals; `prefers-reduced-motion` verified on the new menu (settles at
`opacity 1`, `transform: none`); the presenter's `resume-session`-before-
`create-session` path verified intact across a host reload (`2 / 6` → `2 / 6`,
roster intact); the control bar at 11 controls still fits 1280 × 720 with
141px to spare.

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
| Undo instead of confirm for deck/slide deletion | The right answer, and NN/g prefer it. It needs a server-side tombstone, and `server/` is out of scope for this pass. Recorded in §6 rather than half-built. |

---

## 6. What is still wrong

Ten findings this pass did not fix, in the order they cost a person something.

1. **Seventeen slide types, flat, on first run.** The empty editor offers every
   type at equal weight and recommends none. [Hick's
   Law](https://lawsofux.com/hicks-law/) directly; the fix is a default on the
   empty state ("Ask a multiple-choice question") with the rest behind a
   picker.
2. **The presenter can only step ±1.** A host who needs slide 9 of 20 presses
   `Next` eight times with the room watching every one. There is no jump, no
   grid, no scrubber — and the data for it (`slideTitles`) is already on the
   session ack.
3. **`confirm()` still guards both deletions.** A native modal with no undo,
   for an irreversible act. F5 is only half-satisfied: the deck delete moved a
   layer in, but it is still confirm-then-destroy rather than destroy-then-undo.
4. **The control bar is eleven controls at one level.** It fits, but it is 89%
   of the width at 1280 and it mixes transport, room tools, display settings
   and session lifecycle in one row. The grouping dividers are doing work the
   structure should do.
5. **The editor restores selection but not scroll.** Come back to a long slide
   form and you are at the top of it. F3 is satisfied for the rail and not for
   the pane.
6. **`/templates` and `/transfer` are full-page swaps** for what are
   self-contained tasks — exactly the case Apple's HIG hands to a sheet. Both
   also discard the dashboard's scroll position on the way back, which is an
   F3 violation on a route that did not need to be a route.
7. **The player never sees their position in the deck.** "3 of 6" is status,
   not mirrored content, and a remote player with no shared screen has no idea
   whether the quiz is nearly over. Deferred because it adds chrome to a
   deliberately bare surface and the argument deserves a decision, not a
   default.
8. **The player's lobby does not echo the code they joined.** Mistype a digit
   into a real neighbouring room and there is nothing on the phone to check
   against.
9. **The dashboard does not surface the run that just happened.** "Present
   again" and "Download results" now exist on the final screen, but the moment
   a host leaves it, the most recent session is three presses and a list scan
   away again.
10. **The deck title is still an unlabelled drill-in.** It is now redundant
    rather than load-bearing — `Edit` sits beside it — so this is a
    consistency wrinkle rather than a trap. It stays listed because the
    original defect in this product was exactly this affordance being the
    *only* way in, and a system that forgets its own near-misses re-earns them.

---

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
