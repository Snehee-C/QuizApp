import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { LeaderboardEntry } from "./Podium";
import { avatarFor } from "../lib/avatars";
import { TILE_COLORS, ballBg } from "../lib/palette";
import { NumberTicker } from "./ui/NumberTicker";
import { STAGGER, spring } from "../lib/motion";
import { burstFrom } from "../lib/confetti";
import { cn } from "../lib/cn";

interface BarRaceLeaderboardProps {
  entries: LeaderboardEntry[];
  celebrateLeader?: boolean;
  /** Stage sizing — bigger rows, stage type scale. */
  stage?: boolean;
  className?: string;
}

// The bar-race leaderboard: rows glide to their new rank (FLIP via motion's
// `layout`), bars grow, scores tick up. Rows are staggered 35ms top-first so a
// reorder reads as one organic motion rather than N simultaneous moves.
export function BarRaceLeaderboard({
  entries,
  celebrateLeader = false,
  stage = false,
  className,
}: BarRaceLeaderboardProps) {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const maxScore = Math.max(1, ...sorted.map((e) => e.score));

  const leaderRefs = useRef<Map<string, HTMLElement>>(new Map());
  const prevLeaderRef = useRef<string | null>(null);
  const leaderId = sorted[0]?.participantId ?? null;

  useEffect(() => {
    const prev = prevLeaderRef.current;
    // Guard the first render: only celebrate an actual CHANGE of leader.
    if (celebrateLeader && prev !== null && leaderId !== null && leaderId !== prev) {
      const el = leaderRefs.current.get(leaderId);
      const id = window.setTimeout(() => burstFrom(el ?? null, 110), 420);
      prevLeaderRef.current = leaderId;
      return () => window.clearTimeout(id);
    }
    prevLeaderRef.current = leaderId;
  }, [leaderId, celebrateLeader]);

  if (sorted.length === 0) {
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

  return (
    <div className={cn("flex flex-col w-full", stage ? "gap-4" : "gap-2.5", className)}>
      <AnimatePresence initial={false}>
        {sorted.map((entry, idx) => {
          const a = avatarFor(entry.avatar ?? 0);
          const tile = TILE_COLORS[a.tile % TILE_COLORS.length];
          // `.solid`, NOT `.bubble`: a bar sits on a track with neighbours
          // above and below, so its edge is implied the same way a tile's is
          // in the answer grid. It also carries the player's NAME as ink, and
          // that pairing is measured against this fill (answers.ts).
          const solid = tile.solid;
          const ink = tile.ink;
          const width = 18 + (entry.score / maxScore) * 82;
          const isLeader = idx === 0;
          const h = stage ? "h-[clamp(52px,5.4vh,84px)]" : "h-12";

          return (
            <motion.div
              key={entry.participantId}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{
                layout: spring.default,
                opacity: { duration: 0.28, delay: idx * STAGGER },
                y: { ...spring.default, delay: idx * STAGGER },
              }}
              className="relative flex items-center gap-3"
            >
              <div
                className={cn(
                  "nums shrink-0 text-center font-bold text-ink-subtle",
                  stage ? "w-10 text-stage-label" : "w-5 text-footnote"
                )}
              >
                {idx + 1}
              </div>

              {/* The bar lives in its own track and the name has its own
               * column. Hanging the name off the bar's right edge (as this
               * previously did) pushed it off-screen entirely once the leader's
               * bar reached full width. */}
              <div className={cn("relative flex-1 min-w-0", h)}>
                <motion.div
                  layout
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-md flex items-center",
                    isLeader && "animate-breathe"
                  )}
                  style={{ background: solid }}
                  initial={{ width: "18%" }}
                  animate={{ width: `${width}%` }}
                  transition={spring.slow}
                >
                  <span
                    className={cn(
                      "nums pl-4 font-bold drop-shadow-sm",
                      stage ? "text-stage-label" : "text-subhead"
                    )}
                    style={{ color: ink }}
                  >
                    <NumberTicker value={entry.score} />
                  </span>
                </motion.div>

                <span
                  ref={(el) => {
                    if (el) leaderRefs.current.set(entry.participantId, el);
                    else leaderRefs.current.delete(entry.participantId);
                  }}
                  className="absolute top-1/2 grid place-items-center rounded-pill z-[3] pointer-events-none"
                  style={{
                    left: `${width}%`,
                    width: stage ? 56 : 38,
                    height: stage ? 56 : 38,
                    fontSize: stage ? 28 : 19,
                    transform: "translate(-50%, -50%)",
                    background: ballBg(solid),
                    border: "2.5px solid oklch(1 0 0 / .85)",
                    boxShadow: "0 8px 18px -6px oklch(0 0 0 / .8)",
                    transition: "left 480ms cubic-bezier(.16,1,.3,1)",
                  }}
                >
                  <span className="leading-none">{a.emoji}</span>
                </span>
              </div>

              <div
                className={cn(
                  "shrink-0 font-semibold text-ink truncate",
                  stage ? "w-[clamp(8rem,13vw,16rem)] text-stage-label pl-6" : "w-24 text-subhead pl-4"
                )}
                title={entry.name}
              >
                {entry.name}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
