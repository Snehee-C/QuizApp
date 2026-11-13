import { motion } from "motion/react";
import { avatarFor } from "../lib/avatars";
import { TILE_COLORS, ballBg } from "../lib/palette";
import { NumberTicker } from "./ui/NumberTicker";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { pkeyOf, type RowIdentity } from "./participantKey";

// `participantId` is PRESENTER-ONLY from the server change on — it is a bearer
// token and the phone must not be handed one — and this board is drawn on both
// surfaces. Identity therefore comes from `pkeyOf`, never from the field.
// See components/participantKey.ts.
export interface LeaderboardEntry extends RowIdentity {
  name: string;
  score: number;
  avatar?: number;
}

// The winner card floods with the player's own colour, so its text colour has
// to follow that fill — two of the six slots are light enough that white text
// on them fails contrast.
function paletteOf(entry: LeaderboardEntry) {
  const a = avatarFor(entry.avatar ?? 0);
  return TILE_COLORS[a.tile % TILE_COLORS.length];
}

/** A glossy sphere carrying the entry's avatar, in that player's colour. */
export function AvatarBubble({ avatar, size = 28 }: { avatar?: number; size?: number }) {
  const a = avatarFor(avatar ?? 0);
  // `.bubble` — a lone sphere on a dark canvas; see answers.ts on why this
  // differs from the grid fill.
  const solid = TILE_COLORS[a.tile % TILE_COLORS.length].bubble;
  return (
    <span
      className="relative inline-grid place-items-center rounded-pill shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.58,
        background: ballBg(solid),
        boxShadow:
          "0 6px 14px -6px oklch(0 0 0 / .5), inset 0 -4px 8px oklch(0 0 0 / .28), inset 0 4px 8px oklch(1 0 0 / .4)",
      }}
    >
      <span className="leading-none">{a.emoji}</span>
    </span>
  );
}

// The podium. No cartoon 1-2-3 blocks — that wastes the single biggest
// emotional moment of the session on a small graphic (DESIGN.md §7).
//
// Instead the winner gets a full card flooded with their OWN colour, their
// name in display type and their score counting up; 2nd and 3rd sit beside it
// as smaller, already-resolved cards.
export function Podium({ entries, stage = false }: { entries: LeaderboardEntry[]; stage?: boolean }) {
  const [first, second, third] = entries;
  if (!first) return null;

  return (
    <div className={cn("flex items-stretch justify-center gap-4", stage ? "gap-6" : "gap-3")}>
      {second && <RunnerUp entry={second} place={2} delay={0} stage={stage} />}

      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        // One of the three budgeted uses of the overshoot spring.
        transition={{ ...spring.pop, delay: 0.26 }}
        className={cn(
          "relative overflow-hidden rounded-2xl flex flex-col items-center justify-center text-center",
          stage ? "px-12 py-10 min-w-[22rem]" : "px-7 py-6 min-w-[11rem]"
        )}
        style={{ background: paletteOf(first).solid, color: paletteOf(first).ink }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: "radial-gradient(120% 90% at 50% 0%, oklch(1 0 0 / .14), transparent 62%)" }}
        />
        <span className="relative flex flex-col items-center gap-3">
          <AvatarBubble avatar={first.avatar} size={stage ? 96 : 56} />
          <span
            className={cn(
              "font-display font-bold leading-none",
              stage ? "text-stage-name" : "text-title2"
            )}
          >
            {first.name}
          </span>
          <span
            className={cn(
              "nums font-bold leading-none",
              stage ? "text-stage-q-sm" : "text-title1"
            )}
          >
            <NumberTicker value={first.score} />
          </span>
          <span className="text-caption2 font-semibold uppercase track-label opacity-70">
            Winner
          </span>
        </span>
      </motion.div>

      {third && <RunnerUp entry={third} place={3} delay={0.08} stage={stage} />}
    </div>
  );
}

function RunnerUp({
  entry,
  place,
  delay,
  stage,
}: {
  entry: LeaderboardEntry;
  place: number;
  delay: number;
  stage: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.default, delay }}
      className={cn(
        "self-end rounded-xl bg-surface-1 shadow-elev-1 flex flex-col items-center text-center gap-2",
        stage ? "px-8 py-6 min-w-[15rem]" : "px-5 py-4 min-w-[8rem]"
      )}
    >
      <span className="nums text-caption font-bold uppercase track-label text-ink-subtle">
        #{place}
      </span>
      <AvatarBubble avatar={entry.avatar} size={stage ? 56 : 36} />
      <span
        className={cn(
          "font-ui font-semibold leading-tight text-ink truncate max-w-full",
          stage ? "text-stage-label" : "text-subhead"
        )}
      >
        {entry.name}
      </span>
      <span className={cn("nums font-bold text-ink-muted", stage ? "text-stage-label" : "text-body")}>
        {entry.score}
      </span>
    </motion.div>
  );
}

export function LeaderboardList({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-ink-subtle text-center py-6">No scores yet</p>;
  }
  return (
    <div className="flex flex-col gap-2 w-full">
      {entries.map((e, i) => (
        <motion.div
          key={pkeyOf(e)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.035, duration: 0.24 }}
          className="flex items-center justify-between gap-3 rounded-md bg-surface-1 shadow-line px-4 py-3"
        >
          <span className="flex items-center gap-3 min-w-0">
            <span className="nums w-7 text-center text-footnote font-bold text-ink-subtle">
              {i + 1}
            </span>
            <AvatarBubble avatar={e.avatar} size={28} />
            <span className="font-semibold text-ink truncate">{e.name}</span>
          </span>
          <span className="nums font-bold text-ink-muted shrink-0">{e.score}</span>
        </motion.div>
      ))}
    </div>
  );
}
