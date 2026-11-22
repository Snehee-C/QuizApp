# FLOODLIGHT — Pulse

The third document of the design language. `DESIGN.md` is what a screen looks
like; `FLOW.md` is what happens between two screens; this is what happens
**between an action and its answer** — feedback, time, attention, and the two
minutes memory actually keeps.

The brief is the same one, read at the level of time: **pristine and perfect;
nothing odd or out of place.** At this level it means: no touch goes
unanswered, no wait is unbounded, no clock lies, and the moments people
remember are the moments the budget was spent on.

---

## 0. Why this document exists, and why it starts with an audit

It began as a viral list — *"20 UX Laws to tell Claude for better Design."*
The list was audited before it was adopted, because `FLOW.md` §7 set the
precedent: a philosophy that is careless about its own citations cannot be
trusted about anything else.

The audit found the list is not twenty laws. Postel's law appears twice.
"Minimize target distance" is Fitts's law with the width term deleted — and
width is the stronger half: widening a target buys the same logarithmic
improvement as halving the distance *and* cuts the error rate, which distance
does not. Three Gestalt entries plus Prägnanz are one system, not four laws.
Five entries are aphorisms borrowed from economics, theology, satire and
protocol engineering, with no experimental content at all. Nineteen entries;
roughly fourteen ideas; five that deserve to carry load.

So §1 is the canon — what each law actually is, what it licenses here, and
what may no longer be cited to it. §2 is the six principles built on the ones
that held. §3 is the honest record of where the product currently violates
them, measured in the code (the itemised findings live in `UX-PLAN.md`).

---

## 1. The canon

**Evidence tags:** `LAW` — predictive, parameterised, replicated ·
`EFFECT` — reliably observed, weakly parameterised · `GESTALT` — perceptual
regularity, descriptive not predictive · `HEURISTIC` — true-ish, routinely
over-applied · `APHORISM` — a slogan from another field, no empirical content.

### Tier 1 — Load-bearing. The system is built on these.

| Law | What it actually is | What it licenses here |
|---|---|---|
| **Fitts's law** `LAW` (Fitts 1954; MacKenzie's Shannon form, ISO 9241-9) | The only computable law on the list: `MT = a + b·log₂(D/W + 1)`. Replicated for 70 years across every pointing device. | A numeric constraint, not a vibe. Phone answer tiles sized far above the 44pt/48dp floor (a quarter-screen tile is ~1 bit of difficulty; a 48dp list button is ~4 — the difference between an answer and a timeout). Primary actions inside the bottom thumb arc; destructive actions deliberately far and small — Fitts in reverse. |
| **Peak-end rule** `EFFECT` (Kahneman, Fredrickson, Schreiber & Redelmeier 1993; Alaybek et al. 2022 meta-analysis) | People judge an experience by its peak and its end, with duration neglect. The meta-analytic caveat: the simple average predicts about as well — so it is an *allocation* rule, never permission to let the middle rot. | Where the animation and engineering budget goes: the reveal (the peak) and the podium (the end), including the podium a reloading player gets back. The ending must be personal on every phone, not just the winner's. |
| **Jakob's law** `HEURISTIC` (Nielsen c. 2000) | No controlled study — distilled practice, backed indirectly by transfer-of-learning. An argument for convention where convention is cheap, not a ban on novelty. | Players get 30 seconds to understand this product. Match the Kahoot/Menti model (code → name → coloured tiles → podium) and the Keynote/PowerPoint model (clicker keys, `B`/`W` to blank, drag to reorder). Spend the entire novelty budget on the five signature moments in `DESIGN.md` §5. |
| **Tesler's law** `APHORISM` (Tesler, Apple era — genuinely useful) | Complexity is conserved; it only moves between the system and the person. No unit of "complexity" — its value is as a decision frame. | The allocation rule of a three-surface product, stated as a hard review rule in T4 below: complexity may move to the system or to the host; **never to the player under a countdown.** |
| **The Gestalt contract** `GESTALT` (proximity + similarity — Wertheimer 1923; uniform connectedness — Palmer & Rock **1994**, not 1923) | Descriptive and ordinal: grouping *will* occur, with no formula for how much. The principles compete; connectedness usually beats proximity and similarity when they conflict. | One cross-surface contract: group by spacing (inter-group gap ≥ 2× intra-group), encode role by form and never reuse a form for two roles, and **enclose** anything that must survive hostile viewing (a projector crushing contrast at 6 m). An answer option is recognisably the same object at 6 m on the wall and 6 cm in a hand. |

### Tier 2 — Real, but narrow. Each carries a stated trigger condition.

| Law | The boundary | The rule here |
|---|---|---|
| **Hick's law** `HEURISTIC` (Hick 1952, Hyman 1953; corrective: Cockburn, Gutwin & Dix, CHI 2020) | Valid only for the choice-reaction paradigm: options simultaneously visible, pre-learned, resolved in one decision. Visual search over unfamiliar labels grows *linearly* and is not Hick. | Applies to the answer grid — cap at 4 options in timed rounds. May **not** be cited against a browsable, labelled list (the slide-type picker): chunking and grouping are the fix there, and hiding items taxes the expert. |
| **Von Restorff** `EFFECT` (von Restorff 1933) | Real and mechanistically understood; emphasis is zero-sum. | One accent per view, double-encoded (never colour alone). The discipline it imposes is worth more than the effect it names. On the stage at reveal the accent is the correct answer and *nothing competes*; on the phone it is your own result; on a list the accent belongs to the verb you came for. |
| **Latency budgets** — formerly "Doherty threshold" | The "400 ms" figure does not appear in Doherty & Thadhani 1982 — it is a design-blog artefact. The grounded numbers are NN/g's **0.1 s / 1 s / 10 s**. | Budget at p95, not mean: touch → local acknowledgement 0.1 s; action → result 1 s or a narrated wait; nothing unexplained at 10 s. The lawsofux takeaway that "strategic delays increase perceived value" is **banned**: in a scored game an inserted delay is latency you can be accused of. |
| **Serial position** `EFFECT` (Ebbinghaus 1885; Murdock 1962) | Solid for *transient sequences you must recall*. A persistent nav bar is not recalled, it is looked at — layout arguments from this law are a category error. | An **authoring** law: the first question warms the room up, the last is what it walks out remembering, the grind goes in the middle. Also the reason to randomise option order. In bars and menus, the first and last *positions* go to the most-used controls because they are the cheapest to hit, which is Fitts, not memory. |
| **Parkinson's law** `APHORISM` (Parkinson 1955 — satire; lab support: Bryan & Locke 1967) | The mechanism is goal-setting: people adopt the deadline as the goal. | The per-question timer **is** the difficulty dial, and the editor's defaults **are** the authored outcome — both are set deliberately, per slide type, not left as free-text seconds. A deck's total authored duration is a fact the host must be able to read. |

### Tier 3 — Prompts to measure. They generate tests, not designs.

- **Law of Prägnanz** `GESTALT` — kept as a test procedure, not a principle:
  render every stage slide at 10% scale (the squint test a projector at 6 m
  performs for free); the intended three-block structure — question, options,
  status — must survive. As a "principle" it is unfalsifiable.
- **Occam's razor** `APHORISM` (Ockham c. 1320; the famous phrasing is Punch,
  1639) — a tiebreaker only, and only *after* equivalence is demonstrated.
  The clause every misuse drops is "**that predict equally well**." On the
  stage it genuinely pays (every element consumes contrast budget from the one
  that matters); in the host's chrome it mostly smuggles in an unproven
  equivalence claim.
- **Pareto principle** `APHORISM` (Pareto 1896 never generalised it; Juran
  named it and retracted the attribution in 1975) — spelled honestly: *go
  measure the distribution.* Instrument slide-type usage and control usage;
  allocate polish by the measured curve. "80/20" is a label for skew, not a
  number.

### Tier 4 — Actively resisted.

- **Postel's law** — *"be liberal in what you accept"* (RFC 760/1122) has been
  formally repudiated in its home field: IAB **RFC 9413**, *Maintaining Robust
  Protocols* (2023), grew from a draft titled *"The Harmful Consequences of
  the Robustness Principle."* Leniency makes malformed input load-bearing and
  the failure surfaces later, somewhere worse — here, live, in front of a
  room. It survives only split into **two opposite rules** (T6 below), and it
  is never citable unqualified. The viral list printed it twice; this product
  needed it zero times in that form.
- **Zeigarnik effect** — fails modern replication (Ghibellini & Meier 2025
  meta-analysis: under a third of 44 attempts, pooled d ≈ 0.15, essentially
  nothing once Zeigarnik's own 1927 data is excluded). **Nothing may be cited
  to it.** Progress indicators stay — cited to goal-gradient and plain
  orientation. The manipulative reading (manufactured cliffhangers, withheld
  results "for tension") is rejected outright: the countdown and the
  leaderboard already supply the tension honestly.
- **Miller's law** — already rejected in `FLOW.md` §7; reaffirmed. Cowan
  (2001) puts real working-memory capacity at 4 ± 1, and nothing on a screen
  is held in working memory anyway. The one true Miller case in the product is
  the join code — carried in the head from the wall to the phone — and it is
  solved by the QR, by chunking, and by a forgiving field, not by citing a
  number.

### Citation rules

The lint for arguments, parallel to `lint:design` for tokens:

1. No design argument may cite Zeigarnik, "Miller's seven," or unqualified
   Postel.
2. Citing Hick requires showing all three conditions: simultaneously visible,
   mutually exclusive, one timed decision.
3. Citing Occam requires first demonstrating the alternatives perform equally.
4. "Doherty" is spelled **0.1 / 1 / 10**, and no delay is ever inserted on
   purpose.
5. Fitts is argued in millimetres and bits, or not at all.

---

## 2. The six principles

### T1 — Every touch is answered where it lands, within 100 ms.
The acknowledgement happens **at the point of contact, by the thing touched**,
and it happens locally — never behind the network. A banner elsewhere on the
screen is not an answer; the eye is on the thumb. The server's round trip may
take its full second *behind* the local answer, and reconciliation may correct
it afterwards — an optimistic state that is occasionally corrected beats a
dead tile every time.

The inverse clause: an indicator that appears on every *healthy* action is
also a defect. Progress and warning surfaces are delayed past ~400 ms so that
when they do appear, they are true.

**Test:** throttle to Slow 3G. Tap every control in the product. Any control
whose own pixels have not changed within 100 ms of the tap fails.

### T2 — Silence is never an answer.
Fire-and-forget is forbidden. Every socket emit carries an ack and a timeout;
every awaited write has a catch; every failure has a surface, sized to its
consequence. A system that keeps rendering a change it did not persist is not
quiet — it is lying, and it is lying to the one person standing in front of a
room. The presenter deserves the same venue-Wi-Fi survival kit the phone
already has; the host's connection is not more reliable for being ours.

**Test:** kill the server mid-session, mid-edit, and mid-export. Every surface
must say what stopped within 1 s of knowing, must not destroy anything by way
of "recovery," and must never render success it cannot prove.

### T3 — The clock is a contract.
Extends `DESIGN.md` ("never ease a clock"): a rendered countdown is the
**server's** clock, scaled by the settings that protect people (`timeScale`),
and zero must mean something — it closes the question, or the ring does not
render. A clock whose zero costs nothing is suspense theatre, and a room that
watches a countdown expire into silence has been lied to in public.

**Test:** for every rendered timer, name the event at zero. "Nothing" fails.

### T4 — Complexity flows uphill, away from the clock.
Tesler's conservation, as a hard review rule. Every simplification names who
absorbed the complexity, and the order of preference is fixed: **the system,
then the host before the session, then the host during it, then the player at
the reveal — and never the player while the clock runs.** The concrete floor:
while a question is live, the phone's thumb zone belongs to the answer and to
nothing else. Chrome collapses; reactions wait for the reveal, which is when a
reaction is worth something anyway; every tappable thing on screen is either
the answer or the one status that explains it.

**Test:** on a 375 × 667 viewport with the maximum six options: every option
reachable without scrolling, and no non-answer target inside the bottom thumb
arc while the question is live.

### T5 — The first and last minutes are signature moments.
Peak-end and serial position, as the allocation rule over a session.
`DESIGN.md` §5 budgets five signature moments; two of them — the join and the
podium — are also the two a player's memory keeps, and they are held to the
same standard as the reveal. Joining is at most two inputs from a QR scan, and
failure never costs the player what they already typed. The ending is personal
on every phone: a bare rank is a ranking, `#11 of 34` is a result, and the
winner's confetti is not the mid-table player's ending. The meta-analytic
caveat is part of the principle: the average matters about as much, so none of
this excuses the middle.

**Test:** the podium renders unclipped at 320 px. Every finisher can read a
result that is *about them* without scrolling. The middle of the session never
shows a dead wait (T2) or a dead tap (T1).

### T6 — Liberal with people, strict with machines.
The Postel split, stated so it can be enforced in review. **Human input** is
normalised generously — case, spaces, pasted sentences, look-alike glyphs read
off a wall — and the normalisation is *shown*, so the person sees what was
understood. **Machine input** — import JSON, socket payloads, tokens, ids —
validates against the contract and fails loudly, early, and with a path to the
offending field. Today's lenient parser is tomorrow's compatibility
obligation, and its failure surfaces live in front of a room instead of in the
editor. The product already practices both halves (the forgiving join, the
strict importer); this paragraph exists so no code review can ever cite
"Postel's law" to weaken a parser.

**Test:** paste `Join with code 157 770` into the code field — it joins.
Import a four-option deck with `correctIndices: [4]` — it is rejected with a
slide number and a reason.

---

## 3. The honest record

Measured in the code in November 2026 by auditing every surface against §2,
then fixed in one pass and re-measured by driving the product — not the API
— as one continuous session. The itemised findings, fix shapes and evidence
are `UX-PLAN.md`; this is the summary a reader needs to trust the rest of
this document.

**What was true before the pass, and what is true now:**

- **T1 failed on the product's single most important touch.** A single-select
  answer tap changed nothing on the tile tapped; a second tap silently
  replaced the answer. *Now:* the tapped tile is `chosen` in 4–14 ms and the
  grid locks until the server answers; the "Sending…" strip waits 400 ms so
  it only ever appears when something is wrong.
- **T2 failed worst for the host.** The presenter had no connection
  awareness and every command was fire-and-forget; the editor's autosave had
  no indicator and no error path; a blocked pop-up replaced the projected
  stage with one sentence. *Now:* every presenter emit has an ack and a
  timeout, a server killed mid-question is announced in the control bar
  within 20 ms with the stage intact, and the editor shows `Saving…` /
  `Saved · just now` / `Couldn't save — retrying` and never renders a write
  the server did not ack.
- **T3 failed on self-paced decks.** The stage ran a countdown the server
  deliberately did not arm. *Now:* an AUDIENCE deck renders no ring and says
  so. The stage no longer trails the phones on a slide change: the old frame
  exits while the new one enters, and the question is readable ~108 ms after
  the press instead of ~437 ms.
- **T4 failed by inventory.** Eight non-answer targets in the thumb zone
  during a live question; the Q&A tab was a one-way door. *Now:* one pill
  while the question is live, six options fit a 375 × 667 phone without
  scrolling, and the next slide pulls the phone back to its answer tab.
- **T5 failed at both ends.** The join discovered a wrong code two screens
  late and discarded it; the podium clipped on every standard phone and was
  identical for first and last. *Now:* the code is checked before the
  nickname and survives the error; the ending is `#11 of 34` with the
  player's own line first, unclipped at 320 px, byte-identical across a
  reload. *Still open:* the final-results screen on the stage sits under the
  24 px floor.
- **T6 held at the importer and failed at the field.** *Now:* `Join with
  code 157 770` joins; a filtered nickname is echoed back as what the room
  will see.
- **F7 (FLOW.md) was unnamed.** Every cross-journey ran spoke → hub →
  unsearched scan → spoke. *Now:* one shared header, a filter on the list,
  ⌘K to anything by name, a deck switcher in the editor, `Edit deck` on the
  results page.

**What this pass found about the documents themselves:** `DESIGN.md` §6
claimed two CI audits that did not exist as scripts, and CI was not running
the two that did. The claim is corrected and the real audits are gated. A
system that hides its own corrections cannot be trusted about anything else;
when the open items above are closed, this section records the next set.

## 4. Sources

Primary, and quoted rather than paraphrased, per `FLOW.md` §7's standard.

**On the laws themselves**
- Fitts (1954), *The information capacity of the human motor system*;
  MacKenzie (1992) Shannon formulation; ISO 9241-9.
- Kahneman, Fredrickson, Schreiber & Redelmeier (1993), *When More Pain Is
  Preferred to Less*; Alaybek et al. (2022) meta-analysis of peak-end and
  duration neglect — support for both, with the average predicting about as
  well.
- Cockburn, Gutwin & Dix (CHI 2020), *How Relevant is Hick's Law for HCI?* —
  "observing a log curve is not evidence of Hick's law."
- Cowan (2001), *The magical number 4 in short-term memory*, BBS.
- Doherty & Thadhani (1982), *The Economic Value of Rapid Response Time*,
  IBM — argues sub-second; contains no 400 ms threshold.
  [NN/g, *Response Times: The 3 Important Limits*](https://www.nngroup.com/articles/response-times-3-important-limits/).
- von Restorff (1933); Murdock (1962) serial-position curve.
- Wertheimer (1923) — proximity, similarity, Prägnanz; Palmer & Rock (1994),
  *Rethinking perceptual organization: the role of uniform connectedness*;
  Wagemans et al. (2012), *A Century of Gestalt Psychology in Visual
  Perception*.
- Bryan & Locke (1967), *Parkinson's Law as a goal-setting phenomenon*.
- Juran (1975), *The Non-Pareto Principle; Mea Culpa*.

**On the two repudiations**
- [RFC 9413, *Maintaining Robust Protocols* (IAB, 2023)](https://www.rfc-editor.org/rfc/rfc9413.html),
  née [draft-thomson-postel-was-wrong, *The Harmful Consequences of the
  Robustness Principle*](https://datatracker.ietf.org/doc/draft-thomson-postel-was-wrong/).
- [Ghibellini & Meier (2025), *Interruption, recall and resumption: a
  meta-analysis of the Zeigarnik and Ovsiankina effects*](https://www.nature.com/articles/s41599-025-05000-w)
  — "lacks universal validity."

**The list that prompted this**
- [lawsofux.com](https://lawsofux.com) (Yablonski) — the source of record for
  the popular formulations, including its own caveats, which this document
  takes more seriously than the list did.
