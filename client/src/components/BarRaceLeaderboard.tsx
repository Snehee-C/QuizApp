import { forwardRef, useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  animate,
  useIsPresent,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";
import type { LeaderboardEntry } from "./Podium";
import { avatarFor } from "../lib/avatars";
import { TILE_COLORS, ballBg } from "../lib/palette";
import { RACE, STAGGER, ease, prefersReducedMotion, spring } from "../lib/motion";
import { burstFrom } from "../lib/confetti";
import { playSound } from "../lib/sound";
import { cn } from "../lib/cn";

interface BarRaceLeaderboardProps {
  entries: LeaderboardEntry[];
  /**
   * The board the room last saw. Optional — the component remembers the last
   * board it rendered (see `remembered` below) and that is normally right, so
   * this exists for a caller that genuinely knows better.
   */
  previousEntries?: LeaderboardEntry[] | null;
  celebrateLeader?: boolean;
  /** Stage sizing — bigger rows, stage type scale. */
  stage?: boolean;
  /**
   * How many rows to DRAW. The race still runs over the whole of `entries`,
   * which is the point: see "RACING MORE THAN YOU DRAW" below. Default: all.
   */
  visibleRows?: number;
  /**
   * Scopes the remembered board (see `remembered` below). Must identify the
   * SESSION, not just the surface — `"stage"` is a bug, `"stage:<sessionId>"`
   * is correct. A surface-only key let a host who ended a game and started
   * another on the same deck race the new game's first board up out of the
   * dead game's scores; see the staleness guard in `resolveBaseline`.
   */
  raceKey?: string;
  /**
   * Fired the frame the race resolves — the same beat the +Δ chips arrive on.
   * For a caller that pins its own summary of the result beside the board and
   * must not publish it before the board does. Called immediately (on mount)
   * when there is no race to wait for, including under reduced motion, so a
   * caller can gate on it without the gated thing becoming animation-only.
   */
  onSettled?: () => void;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// THE BAR RACE
//
// The standings are the second-biggest moment in the product and before this
// they were not a moment at all. Measured on a live room at 1920×1080: the
// board arrived in ONE frame, at t=349ms, in final order with final scores
// and final bar widths. A player who went from third to first with a 955-point
// question saw herself already at the top, with no evidence she had ever been
// anywhere else. `layout` was on the rows and `spring.default` was wired to
// it, but neither could ever fire: the component mounts fresh each time the
// host opens the standings, and the entries it mounts with are already
// sorted, so there is no reorder for FLIP to animate. (The leader-change
// confetti was dead for the same reason — `prevLeaderRef` is null on the only
// render that has data, so the guard never passed. It now fires from the
// settle beat, where it belongs.)
//
// The mechanic that makes this electric in Kahoot is WITHHOLDING. You are
// shown the order you already remember, you find your own row in it, and only
// then do the bars start to move. The reorder is watched, not presented as
// finished. So:
//
//   arm (900ms)   rows land in the PREVIOUS order and hold. An accent line
//                 fills across the top — the mute-room equivalent of the
//                 riser, and the thing that says "this is a pause, not a
//                 freeze".
//   run (1150ms)  every score interpolates from its old value to its new one.
//                 Bars, numbers and RANK all read from that one interpolation,
//                 so a row overtakes at the exact frame its bar passes the one
//                 above it. Nothing schedules the reorder; it is a consequence.
//   settle        +Δ chips and rank moves fade in, the chord resolves, and the
//                 leader gets confetti if the leader changed.
//
// RACING MORE THAN YOU DRAW. The stage shows five rows, because past row five
// nothing is readable at 15ft. For a while it was also only *given* five, and
// that quietly cost the board its best moment: a player arriving from sixth
// had no remembered score, so the one row on screen that had genuinely moved
// was the one row that did not move. Measured on the case this is written for
// — Devika, 6th on 0 points, first on 973 after a 973-point question — her row
// was present in 232 of 253 sampled frames at a constant bar width of 1268px
// and a constant score of "973", already first, from frame one. The four rows
// she had just overtaken all carried a ↓1 chip explaining a demotion the room
// never saw happen.
//
// So `entries` is now the WHOLE board the caller has (the server sends a top
// ten) and `visibleRows` is how many of it to draw. The race, the remembered
// baseline and the sort all run over the full set; only the render is sliced.
// A climber enters the visible five at the exact frame her interpolated score
// passes the fifth row's, and the row she displaced leaves on the same frame —
// both through the same AnimatePresence the reorder already used.
//
// This is a window onto one race, not five rows racing. It is also why the
// re-sort below compares the SLICE rather than the full order: in a big room
// two players swapping 47th and 48th must not cost the stage a React render.
//
// WHERE THE PREVIOUS BOARD COMES FROM. Nowhere new — that is the point. The
// server pushes `leaderboard:updated` on every single submission, so by the
// time the host presses "Standings" the presenter's state holds only the final
// board; the pre-question one was overwritten a submission at a time while the
// question was still on screen. But this component is mounted ONLY while the
// standings are up, so the last board it rendered is, by construction, exactly
// the board the room last saw. That is what `remembered` keeps. No new socket
// event, no server change.
// ─────────────────────────────────────────────────────────────────────────

/** The last board each surface rendered. See the note above. */
const remembered = new Map<string, LeaderboardEntry[]>();

type RaceMode = "none" | "cold" | "warm";

interface Baseline {
  mode: RaceMode;
  /** participantId -> the score and rank the room last saw. */
  prev: Map<string, { score: number; rank: number }>;
  leader: string | null;
}

// Deliberately knows nothing about `prefers-reduced-motion`. The baseline is
// DATA — what the room saw last time, and therefore what every player gained
// and how far they moved — and a reader who asked for a calmer screen is
// still owed it. Folding the two together is how a reduced-motion user ends
// up with a board that silently refuses to say who won the round: the race is
// the only thing reduced motion may take away.
function resolveBaseline(
  entries: LeaderboardEntry[],
  explicit: LeaderboardEntry[] | null | undefined,
  key: string
): Baseline {
  const empty: Baseline = { mode: "none", prev: new Map(), leader: null };
  if (entries.length === 0) return empty;

  const prior = explicit ?? remembered.get(key) ?? null;
  const ids = new Set(entries.map((e) => e.participantId));

  // Cold: no order to withhold, so everyone races up from zero instead.
  // Still a race — just one with no overtakes in it.
  const cold: Baseline = { mode: "cold", prev: new Map(), leader: null };

  // A remembered board that shares nobody with this one is a DIFFERENT room.
  // Racing the new game's first board up out of the old game's order would be
  // a lie, and a very confident-looking one.
  const overlap = prior?.filter((e) => ids.has(e.participantId)) ?? [];
  if (overlap.length === 0) return cold;

  const prev = new Map<string, { score: number; rank: number }>();
  prior!.forEach((e, i) => prev.set(e.participantId, { score: e.score, rank: i }));

  // ── The staleness guard ───────────────────────────────────────────────
  // A score inside one session only ever goes UP. So a remembered score that
  // is HIGHER than the same player's score right now is proof the remembered
  // board belongs to a different game — and, unlike the overlap test above,
  // it still holds when the two games have the same audience.
  //
  // That case is not exotic; it is the most ordinary thing a host does with a
  // quiz deck, which is run it twice. Measured before this existed, with a
  // surface-scoped `raceKey` and the same four phones: game two's first
  // standings opened holding the ENDED game's scores (1,959 / 1,927 / 1,893
  // / 1,860), which against the new game's maximum put the widest bar at 1.82x
  // its track — 521px off the right edge of a 1920px stage, names and avatars
  // off-screen entirely — held there for the full 900ms arm before every bar
  // raced DOWNWARD. The overlap heuristic could never catch it: a replay with
  // the same audience has TOTAL overlap, so it read as the same room.
  //
  // The keys are now session-scoped at both call sites, which is the real fix.
  // This is the guard that makes the component unable to do it anyway.
  const stale = entries.some((e) => {
    const k = prev.get(e.participantId);
    return k !== undefined && k.score > e.score;
  });
  if (stale) return cold;

  // Nothing changed — the host toggled the standings off and back on, or the
  // last slide scored nobody. Replaying a race with no movement in it is a
  // 2-second pause that resolves into the same picture.
  //
  // "Changed" has to mean the same thing here as it does in `prevScoreOf`, or
  // the component arms a race it cannot run. It did not: this test read an
  // unremembered player's previous score as 0 and said "race", while
  // `prevScoreOf` read it as their FINAL score and seated them where they
  // already are. Measured — four players, one of whom skipped a question and
  // so had no remembered row, then scored alone on the next one: mode WARM,
  // the full 2,050ms played, ZERO order changes, and the first and last frames
  // byte-identical. The room was held on a board that was already final.
  //
  // So only a player we actually remember can carry evidence of movement.
  const moved = entries.some((e) => {
    const k = prev.get(e.participantId);
    return k !== undefined && k.score !== e.score;
  });
  if (!moved) return empty;

  return { mode: "warm", prev, leader: prior![0]?.participantId ?? null };
}

export function BarRaceLeaderboard({
  entries,
  previousEntries,
  celebrateLeader = false,
  stage = false,
  visibleRows,
  raceKey = "default",
  onSettled,
  className,
}: BarRaceLeaderboardProps) {
  // How many rows reach the screen. Everything else in here works on all of
  // `entries`.
  const drawn = visibleRows ?? entries.length;

  // Held in a ref so the clock effect below can stay a mount-once effect: a
  // caller passing an inline arrow must not be able to restart the race.
  const settledCb = useRef(onSettled);
  settledCb.current = onSettled;

  // Read once. A media-query flip mid-race would leave the animation half
  // committed, and this is a 2-second moment, not a session-long preference.
  const reduced = useRef<boolean | null>(null);
  if (reduced.current === null) reduced.current = prefersReducedMotion();

  const baseRef = useRef<Baseline | null>(null);
  if (baseRef.current === null) {
    baseRef.current = resolveBaseline(entries, previousEntries, raceKey);
  }
  const base = baseRef.current;
  const armMs = base.mode === "warm" ? RACE.arm : RACE.armCold;

  // Whether the race RUNS. Reduced motion is the one case where the board has
  // a story to tell and tells it in text instead: rows that travel up and
  // down the screen are precisely what the setting exists to prevent, and a
  // hold that resolves into a jump-cut would be worse for a vestibular
  // reader than no hold at all. So the beats are dropped — and the +Δ chips
  // and rank moves below, which would otherwise be a flourish on top of the
  // animation, become the whole channel and are on screen from frame one.
  const animated = !reduced.current && base.mode !== "none";

  // The finishing line. Fixed at the FINAL maximum for the whole race, never
  // recomputed from the interpolated values — a moving denominator would make
  // every bar shrink each time the leader grew, which looks like a bug and
  // destroys the one thing a bar race is for.
  const maxScore = Math.max(1, ...entries.map((e) => e.score));
  // What this row's score WAS. The three modes differ, and the fallback in
  // `warm` is the subtle one.
  //
  //   none  — no race; start where you end.
  //   cold  — no remembered board at all; everyone starts at zero.
  //   warm  — the remembered score. A row with NO remembered score is a row
  //           that was not on the board the room last saw AT ALL — a player
  //           who joined mid-session, or one the server's top ten did not
  //           reach. (It is no longer "someone arriving from sixth": the
  //           caller passes the whole board now and `visibleRows` decides
  //           what is drawn, so sixth has a remembered score like everyone
  //           else.) For a row we genuinely never showed, the one thing we
  //           must not do is invent a number: racing them up from zero would
  //           put a score on the screen they never had, and dropping them to
  //           the bottom row would claim a position the remembered board
  //           never showed. So they do not move, and they carry no +Δ and no
  //           rank arrow — the component says nothing rather than something
  //           false.
  const prevScoreOf = (id: string) => {
    if (base.mode === "none") return entries.find((e) => e.participantId === id)?.score ?? 0;
    if (base.mode === "cold") return 0;
    const known = base.prev.get(id);
    return known ? known.score : (entries.find((e) => e.participantId === id)?.score ?? 0);
  };

  /** 0 = the board the room remembers, 1 = the board it is about to have. */
  const p = useMotionValue(animated ? 0 : 1);
  const [phase, setPhase] = useState<"arm" | "run" | "settled">(animated ? "arm" : "settled");

  // `entries` arrives sorted by the server, so an entry's index in it IS the
  // authoritative final rank — including however the server breaks ties.
  const finalIndex = new Map(entries.map((e, i) => [e.participantId, i]));

  const liveOrder = (v: number) =>
    [...entries]
      .sort((a, b) => {
        const ai = prevScoreOf(a.participantId) + (a.score - prevScoreOf(a.participantId)) * v;
        const bi = prevScoreOf(b.participantId) + (b.score - prevScoreOf(b.participantId)) * v;
        // The tie-break is INTERPOLATED on the same v, which is the only way
        // it can be right at both ends: at v=0 it is the remembered rank, so
        // the board reproduces what the room saw last time down to the order
        // of two players on equal points; at v=1 it is the server's own order,
        // so the board the race lands on is exactly the board the server sent.
        // Picking one of the two and using it throughout gets the other end
        // wrong — measured: two players tied on 0 were shown bottom-two in the
        // wrong order at v=0, because the FINAL scores were deciding it.
        return (
          bi - ai ||
          tieOf(a.participantId, v) - tieOf(b.participantId, v) ||
          a.participantId.localeCompare(b.participantId)
        );
      })
      .map((e) => e.participantId);

  function tieOf(id: string, v: number) {
    const will = finalIndex.get(id) ?? entries.length;
    // No remembered rank means no claim about where this row came from
    // (see prevScoreOf): it sits at its final place for the whole race.
    const was = base.prev.get(id)?.rank ?? will;
    return was + (will - was) * v;
  }

  // Where every row SITS ON THE FIRST FRAME — the board the room is actually
  // shown during the hold, which is not always the board we remember.
  //
  // A ↑/↓ chip is a claim about a journey the room just watched, so it has to
  // be measured from the frame the journey started on. Measuring it from the
  // remembered board instead was wrong whenever the two differed, and they
  // differ for exactly one reason: a player with no remembered score is
  // seated at their final score (see prevScoreOf), so they are drawn from
  // frame one in a position the remembered board never showed. Measured —
  // a player who sat out a question and then scored alone on the next one
  // entered the board above two others, and those two were handed a "↓1"
  // each for a demotion that happened before the race began and that nobody
  // in the room ever saw. Off the start order they are both ↓0, which is the
  // truth: on screen, neither moved.
  //
  // It also makes the unremembered player honest in the other direction. He
  // starts where he ends, so he is ↓0 too — the component says nothing about
  // him rather than something false, which is the same rule prevScoreOf keeps.
  const startRank = new Map(liveOrder(0).map((id, i) => [id, i]));
  const startLeader = liveOrder(0)[0] ?? null;

  /** The rows actually on screen: the top `drawn` of the live order. */
  const [order, setOrder] = useState<string[]>(() => liveOrder(p.get()).slice(0, drawn));
  // Captured once: the stagger delay has to come from where a row STARTS, or
  // a row that overtakes during the run would retroactively change the
  // entrance it already played.
  const entranceIndex = useRef<Map<string, number>>(new Map());
  if (entranceIndex.current.size === 0) {
    order.forEach((id, i) => entranceIndex.current.set(id, i));
  }

  // Re-sort off the interpolation, not off a timer. setState only when the
  // sequence actually changes, so the run costs a handful of renders rather
  // than one per frame — which also keeps `layout` from re-measuring 70 times
  // and fighting its own FLIP.
  useEffect(() => {
    const recompute = (v: number) => {
      // Sliced before the comparison, not after: the stage draws five rows out
      // of up to ten, and a swap below the cut line changes nothing on screen.
      const next = liveOrder(v).slice(0, drawn);
      setOrder((cur) =>
        cur.length === next.length && cur.every((id, i) => id === next[i]) ? cur : next
      );
    };
    recompute(p.get());
    return p.on("change", recompute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, entries, drawn]);

  // The clock.
  useEffect(() => {
    // Nothing to withhold: tell the caller the board is final NOW. Reduced
    // motion lands here, which is deliberate — a caller gating a number on
    // `onSettled` must not end up with a number that only exists if the
    // animation ran.
    if (!animated) {
      settledCb.current?.();
      return;
    }
    const runMs = RACE.run;
    // One riser spanning the hold AND the run: the build has to end where the
    // picture ends, or it tells the room the moment is over early.
    if (stage) playSound("riser", { duration: (armMs + runMs) / 1000 });

    const controls = animate(p, 1, {
      duration: runMs / 1000,
      delay: armMs / 1000,
      // The house standard curve, not `entrance`. Measured with `entrance`
      // (decelerate-only, ~4.4× linear initial velocity): 6% of every gap was
      // closed inside the FIRST FRAME of the run, which was enough to settle
      // a 26-point gap between the old leader and her challenger before a
      // single frame had been drawn in between — a reorder presented as
      // finished, which is the exact defect this whole component exists to
      // remove. `standard` eases in as well as out, so the first crossing
      // moves from 16ms to ~55ms and is a motion rather than a cut, and the
      // bars still cover ~28% of their distance in the first 150ms, so
      // nothing reads as stalled.
      ease: ease.standard,
    });
    const toRun = window.setTimeout(() => setPhase("run"), armMs);
    const toSettle = window.setTimeout(() => {
      setPhase("settled");
      if (stage) playSound("land");
      settledCb.current?.();
    }, armMs + runMs);

    return () => {
      controls.stop();
      window.clearTimeout(toRun);
      window.clearTimeout(toSettle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember what this surface showed, for the next time it opens.
  useEffect(() => {
    if (entries.length) remembered.set(raceKey, entries);
  }, [entries, raceKey]);

  // Confetti on a genuine lead change, fired at the settle beat — the frame
  // the new leader is confirmed, not the frame the data arrived.
  const leaderRefs = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    if (!celebrateLeader || phase !== "settled" || base.mode !== "warm") return;
    const winner = order[0];
    if (!winner || winner === startLeader) return;
    burstFrom(leaderRefs.current.get(winner) ?? null, 110);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (entries.length === 0) {
    return (
      <p
        className={cn(
          "text-ink-subtle text-center py-6",
          stage ? "text-stage-name" : "text-subhead"
        )}
      >
        No scores yet
      </p>
    );
  }

  const byId = new Map(entries.map((e) => [e.participantId, e]));
  const settled = phase === "settled";
  // The ledger is only honest in `warm`. A cold board has no remembered
  // scores, so "+971" there would be a player's SESSION TOTAL wearing a
  // round-delta chip — which, on a host who opens the standings for the first
  // time after question three, is simply a wrong number. The cold race up from
  // zero already says everything that can be said.
  const showDelta = base.mode === "warm";

  return (
    <div className={cn("flex flex-col w-full", stage ? "gap-4" : "gap-2.5", className)}>
      {/* The arming line. This is the riser's visual half, and the only thing
       * on screen during the hold — without it a muted room cannot tell a
       * deliberate pause from a stalled projector. Carries real information
       * (how long until the bars move), which is what earns it a place under
       * P2. `linear`, because it is a clock. */}
      {base.mode === "warm" && animated && (
        <motion.div
          className={cn("relative w-full overflow-hidden rounded-pill", stage ? "h-1.5" : "h-1")}
          style={{ background: "color-mix(in oklch, var(--ink), transparent 88%)" }}
          animate={{ opacity: phase === "arm" ? 1 : 0 }}
          transition={{ duration: 0.24, ease: ease.exit }}
        >
          <motion.div
            data-race-arm
            className="absolute inset-y-0 left-0 rounded-pill"
            style={{ background: "var(--accent)" }}
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: armMs / 1000, ease: "linear" }}
          />
        </motion.div>
      )}

      {/* `popLayout`, not the default sync mode. A row leaving the visible
       * window and the row replacing it overlap in time by design — that IS
       * the overtake — but in sync mode the outgoing row holds its place in
       * the layout flow for the whole of its exit, so the list grows to hold
       * both. Measured on ten players where the bottom five overtook the top
       * five in one race: TEN rows mounted against a `visibleRows` of five,
       * ranks reading 1,2,3,4,5 then 1,2,3,4,5 again, two different players'
       * rows drawn legibly on top of one another, the list box 356px -> 553px
       * -> 356px and every row jolting 18px up and back (the section is
       * `justify-center`). It held for 416ms of a 2-second moment. A plain
       * two-row swap in a 28-player room mounted seven.
       *
       * `popLayout` takes the exiting row out of flow, so the five slots stay
       * five slots and the row it is handing over to can slide into the place
       * it just left. */}
      <AnimatePresence initial={false} mode="popLayout">
        {order.map((id, idx) => {
          const entry = byId.get(id);
          if (!entry) return null;
          return (
            <RaceRow
              key={id}
              entry={entry}
              rank={idx + 1}
              isLeader={idx === 0}
              prevScore={prevScoreOf(id)}
              prevRank={startRank.get(id) ?? null}
              maxScore={maxScore}
              p={p}
              stage={stage}
              reduced={reduced.current!}
              settled={settled}
              showDelta={showDelta}
              // No captured index means this row was not on screen when the
              // board landed — it climbed into the visible window during the
              // run. The stagger is the ENTRANCE's rhythm and this is not the
              // entrance, so it gets none: a row that has just overtaken four
              // people must appear on the frame it earned, not 175ms later.
              entranceDelay={(entranceIndex.current.get(id) ?? 0) * STAGGER}
              onBallRef={(el) => {
                if (el) leaderRefs.current.set(id, el);
                else leaderRefs.current.delete(id);
              }}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ── one row ─────────────────────────────────────────────────────────── */

interface RaceRowProps {
  entry: LeaderboardEntry;
  rank: number;
  isLeader: boolean;
  prevScore: number;
  prevRank: number | null;
  maxScore: number;
  p: MotionValue<number>;
  stage: boolean;
  reduced: boolean;
  settled: boolean;
  showDelta: boolean;
  entranceDelay: number;
  onBallRef: (el: HTMLElement | null) => void;
}

// forwardRef, and it is load-bearing rather than tidiness: `AnimatePresence`
// in `popLayout` mode lifts an exiting child out of the layout flow by cloning
// it with a ref and positioning the real node absolutely. A plain function
// component cannot be given a ref, so the clone silently fails and popLayout
// degrades to the sync behaviour it was chosen to replace — measured, and it
// measured as no change at all: still ten rows in a five-row list, still a
// 356px box growing to 553px. There is no error and no warning; the only
// symptom is that the mode does nothing.
const RaceRow = forwardRef<HTMLDivElement, RaceRowProps>(function RaceRow({
  entry,
  rank,
  isLeader,
  prevScore,
  prevRank,
  maxScore,
  p,
  stage,
  reduced,
  settled,
  showDelta,
  entranceDelay,
  onBallRef,
}: RaceRowProps, ref) {
  // False once this row has fallen out of the visible window and is playing
  // its exit. See the rank digit below.
  const isPresent = useIsPresent();

  const a = avatarFor(entry.avatar ?? 0);
  const tile = TILE_COLORS[a.tile % TILE_COLORS.length];
  // `.solid`, NOT `.bubble`: a bar sits on a track with neighbours above and
  // below, so its edge is implied the same way a tile's is in the answer grid.
  // It also carries the player's SCORE as ink, and that pairing is measured
  // against this fill (answers.ts).
  const solid = tile.solid;
  const ink = tile.ink;
  const h = stage ? "h-[clamp(52px,5.4vh,84px)]" : "h-12";

  // Everything positional reads from ONE interpolation, which is why the bar,
  // the number and the row's rank can never disagree with each other.
  const live = useTransform(p, (v) => prevScore + (entry.score - prevScore) * v);
  // Clamped at the track. `maxScore` is the FINAL maximum and a score inside
  // one session only goes up, so a bar can only exceed its track if the
  // baseline came from somewhere it should not have — which `resolveBaseline`
  // now refuses, and the session-scoped `raceKey` now prevents. This is the
  // third and last line of that defence, and the only one that is purely
  // local: whatever a caller remembers, the picture stays on the stage. The
  // track is `overflow: visible` by necessity (the avatar ball rides the
  // bar's leading edge and must not be clipped), so nothing else would stop
  // it — measured at 2,441px on a 1,920px screen before this.
  const pct = useTransform(live, (s) => Math.min(100, 18 + (s / maxScore) * 82));
  const width = useTransform(pct, (w) => `${w}%`);
  const left = useTransform(pct, (w) => `${w}%`);

  const delta = entry.score - prevScore;
  const rankMove = prevRank === null ? null : prevRank - (rank - 1);

  return (
    <motion.div
      ref={ref}
      data-race-row
      // "position" only: the row never changes size, and a size-aware layout
      // animation would try to animate the bar's width too, fighting the
      // motion value that actually owns it.
      layout="position"
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      // DOWN, not up. A row only ever leaves this list by being overtaken, so
      // it sinks past the cut line while the row that passed it rises into the
      // slot — one gesture, two halves, read in the direction it happened.
      // (It used to leave upward, which is the gesture for being promoted off
      // the top of a list and says the opposite of what occurred.)
      //
      // Its own transition, because `entranceDelay` must not apply here: the
      // stagger is the ENTRANCE's rhythm, and a row five slots down was
      // holding its place for 175ms before it would begin to fade.
      exit={{
        opacity: 0,
        y: reduced ? 0 : 12,
        transition: { duration: reduced ? 0.12 : 0.2, ease: ease.exit },
      }}
      transition={{
        layout: spring.default,
        opacity: { duration: reduced ? 0.12 : 0.28, delay: entranceDelay },
        y: { ...spring.default, delay: entranceDelay },
      }}
      className="relative flex items-center gap-3"
    >
      {/* The rank goes the instant the row starts leaving. `rank` is this
       * row's index in the DRAWN five, and an exiting row keeps the props it
       * had when it was still one of them — so for the length of its exit the
       * board carries two rows numbered the same, which on a projector reads
       * as two people tied for a place neither of them holds. The row itself
       * is still worth watching out (it is the losing half of the overtake);
       * its number is the one part of it that has already stopped being true.
       * Kept in flow, never unmounted, so the row does not reflow as it goes. */}
      <div
        className={cn(
          "nums shrink-0 text-center font-bold text-ink-subtle",
          stage ? "w-10 text-stage-label" : "w-5 text-footnote"
        )}
        style={{ opacity: isPresent ? 1 : 0 }}
        aria-hidden={!isPresent}
      >
        {rank}
      </div>

      {/* The bar lives in its own track and the name has its own column.
       * Hanging the name off the bar's right edge (as this once did) pushed it
       * off-screen entirely once the leader's bar reached full width. */}
      <div className={cn("relative flex-1 min-w-0", h)}>
        <motion.div
          data-race-bar
          className={cn(
            "absolute inset-y-0 left-0 rounded-md flex items-center",
            isLeader && "animate-breathe"
          )}
          style={{ background: solid, width }}
        >
          <span
            data-race-score
            className={cn(
              "nums tabular-nums pl-4 font-bold drop-shadow-sm",
              stage ? "text-stage-label" : "text-subhead"
            )}
            style={{ color: ink }}
          >
            <RacingScore value={live} />
          </span>
        </motion.div>

        <motion.span
          ref={onBallRef}
          className="absolute top-1/2 grid place-items-center rounded-pill z-[3] pointer-events-none"
          style={{
            left,
            width: stage ? 56 : 38,
            height: stage ? 56 : 38,
            fontSize: stage ? 28 : 19,
            x: "-50%",
            y: "-50%",
            background: ballBg(solid),
            border: "2.5px solid oklch(1 0 0 / .85)",
            boxShadow: "0 8px 18px -6px oklch(0 0 0 / .8)",
          }}
        >
          <span className="leading-none">{a.emoji}</span>
        </motion.span>
      </div>

      <div
        data-race-name
        className={cn(
          "shrink-0 font-semibold text-ink truncate",
          stage ? "w-[clamp(8rem,13vw,16rem)] text-stage-label pl-6" : "w-20 text-subhead pl-4"
        )}
        title={entry.name}
      >
        {entry.name}
      </div>

      {/* The ledger: what this round was worth, and how far it moved you.
       *
       * This is the half of the moment that survives `prefers-reduced-motion`.
       * With the race suppressed the board simply arrives — so if the change
       * lived only in the animation, a player who asked for a calmer screen
       * would be told nothing at all. It does not: +955 and ↑2 say the same
       * thing the bars said, in text, and they stay on screen afterwards.
       *
       * Never red/green (§5). A gain is the accent; a drop is ink-subtle and
       * carries its own arrow. Being overtaken is not punished. */}
      {showDelta && (
        <motion.div
          data-race-delta
          className={cn(
            "shrink-0 flex items-center justify-end gap-1.5",
            stage ? "w-[clamp(5.5rem,8vw,10rem)] text-stage-label" : "w-16 text-caption"
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: settled ? 1 : 0 }}
          transition={{ duration: reduced ? 0.12 : 0.26, ease: ease.entrance }}
        >
          {delta > 0 && (
            <span
              className={cn("nums tabular-nums font-bold rounded-pill", stage ? "px-3 py-0.5" : "px-1.5")}
              style={{
                color: "var(--accent)",
                background: "color-mix(in oklch, var(--accent), transparent 86%)",
              }}
            >
              +{delta.toLocaleString()}
            </span>
          )}
          {rankMove !== null && rankMove !== 0 && (
            <span
              className="nums font-bold"
              // `--ink-muted`, not `--ink-subtle`. A drop must read quieter
              // than a gain — being overtaken is not punished (§5) — but
              // measured on the stage, subtle came back at 5.41:1, under the
              // 7:1 the room contract sets and under even the documented
              // 5.6–7.0 dead-zone exception. Muted measures 11.5:1 and is
              // still visibly the quieter of the two next to the accent's
              // 13.9:1. De-emphasis on a projector has a floor.
              style={{ color: rankMove > 0 ? "var(--accent)" : "var(--ink-muted)" }}
              aria-label={rankMove > 0 ? `up ${rankMove}` : `down ${-rankMove}`}
            >
              {rankMove > 0 ? "↑" : "↓"}
              {Math.abs(rankMove)}
            </span>
          )}
        </motion.div>
      )}
    </motion.div>
  );
});

/**
 * The score, written straight to the DOM from the interpolation.
 *
 * Deliberately NOT NumberTicker. That component runs its own 850ms ease-out
 * off its own clock, which would put the number on a different timeline from
 * the bar carrying it and from the rank it is being used to justify — the one
 * thing a bar race cannot afford. Writing textContent also keeps a 1150ms run
 * at zero React renders per frame.
 */
function RacingScore({ value }: { value: MotionValue<number> }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Stable across renders, so React never reconciles the imperative text away.
  const initial = useRef(Math.round(value.get()).toLocaleString());
  useEffect(() => {
    const write = (v: number) => {
      if (ref.current) ref.current.textContent = Math.round(v).toLocaleString();
    };
    write(value.get());
    return value.on("change", write);
  }, [value]);
  return <span ref={ref}>{initial.current}</span>;
}
