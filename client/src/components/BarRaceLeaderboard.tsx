import { useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  animate,
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
  /** Scopes the remembered board. One key per surface. */
  raceKey?: string;
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

  // A remembered board that shares nobody with this one is a DIFFERENT room —
  // the host ended a session and started another in the same tab. Racing the
  // new game's first board up out of the old game's order would be a lie, and
  // a very confident-looking one.
  const overlap = prior?.filter((e) => ids.has(e.participantId)) ?? [];
  if (overlap.length === 0) {
    // Cold: no order to withhold, so everyone races up from zero instead.
    // Still a race — just one with no overtakes in it.
    return { mode: "cold", prev: new Map(), leader: null };
  }

  const prev = new Map<string, { score: number; rank: number }>();
  prior!.forEach((e, i) => prev.set(e.participantId, { score: e.score, rank: i }));

  // Nothing changed — the host toggled the standings off and back on, or the
  // last slide scored nobody. Replaying a race with no movement in it is a
  // 2-second pause that resolves into the same picture.
  const moved = entries.some((e) => (prev.get(e.participantId)?.score ?? 0) !== e.score);
  if (!moved) return empty;

  return { mode: "warm", prev, leader: prior![0]?.participantId ?? null };
}

export function BarRaceLeaderboard({
  entries,
  previousEntries,
  celebrateLeader = false,
  stage = false,
  raceKey = "default",
  className,
}: BarRaceLeaderboardProps) {
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
  //           that was not on the board the room last saw. On the stage that
  //           board is the top five, so this is usually someone arriving from
  //           sixth, and the one thing we must not do is invent a number for
  //           them: racing them up from zero would put a score on the screen
  //           they never had, and dropping them to the bottom row would claim
  //           a position the remembered board never showed. So they do not
  //           move, and they carry no +Δ and no rank arrow — the component
  //           says nothing rather than something false.
  //
  //           This is the one place the moment is poorer than it could be,
  //           and it is a DATA limit, not a design one: a caller that passes
  //           the full board through `previousEntries` (or simply renders
  //           more rows than the stage shows) gets the sixth-to-first climb
  //           for free, with no change here.
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

  const [order, setOrder] = useState<string[]>(() => liveOrder(p.get()));
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
      const next = liveOrder(v);
      setOrder((cur) =>
        cur.length === next.length && cur.every((id, i) => id === next[i]) ? cur : next
      );
    };
    recompute(p.get());
    return p.on("change", recompute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, entries]);

  // The clock.
  useEffect(() => {
    if (!animated) return;
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
    if (!winner || winner === base.leader) return;
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

      <AnimatePresence initial={false}>
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
              prevRank={base.prev.get(id)?.rank ?? null}
              maxScore={maxScore}
              p={p}
              stage={stage}
              reduced={reduced.current!}
              settled={settled}
              showDelta={showDelta}
              entranceDelay={(entranceIndex.current.get(id) ?? idx) * STAGGER}
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

function RaceRow({
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
}: RaceRowProps) {
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
  const pct = useTransform(live, (s) => 18 + (s / maxScore) * 82);
  const width = useTransform(pct, (w) => `${w}%`);
  const left = useTransform(pct, (w) => `${w}%`);

  const delta = entry.score - prevScore;
  const rankMove = prevRank === null ? null : prevRank - (rank - 1);

  return (
    <motion.div
      data-race-row
      // "position" only: the row never changes size, and a size-aware layout
      // animation would try to animate the bar's width too, fighting the
      // motion value that actually owns it.
      layout="position"
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : -12 }}
      transition={{
        layout: spring.default,
        opacity: { duration: reduced ? 0.12 : 0.28, delay: entranceDelay },
        y: { ...spring.default, delay: entranceDelay },
      }}
      className="relative flex items-center gap-3"
    >
      <div
        className={cn(
          "nums shrink-0 text-center font-bold text-ink-subtle",
          stage ? "w-10 text-stage-label" : "w-5 text-footnote"
        )}
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
}

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
