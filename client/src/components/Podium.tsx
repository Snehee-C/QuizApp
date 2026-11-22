import { motion } from "motion/react";
import { avatarFor } from "../lib/avatars";
import { TILE_COLORS, ballBg } from "../lib/palette";
import { NumberTicker } from "./ui/NumberTicker";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { pkeyOf, type RowIdentity } from "./participantKey";
import { useStageScale } from "./stageScale";

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

/** The winner's own fill — what the stage floods the screen with. */
export function winnerHue(entry: LeaderboardEntry): string {
  return paletteOf(entry).solid;
}

/**
 * When each stage card lands, in seconds. The stage counts UP to the winner —
 * third, then second, then a beat, then first — because the room is reading
 * one screen together and the order is the suspense. The phone is a private
 * result the player already knows the shape of, so it keeps arriving at once.
 * `FinalResults` times its confetti and its own entrances off these.
 */
export const PODIUM_STAGE_TIMING = { third: 0.2, second: 0.5, winner: 0.95 } as const;

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
//
// Two layouts, one vocabulary. The STAGE keeps the three-across row it has
// always had. The PHONE stacks: the row needed 456px (176 + 2×128 + gaps)
// inside a 375px screen with `overflow-hidden` on the shell, so #2 and #3
// were clipped in half, unscrollable, on the biggest emotional moment in the
// product (UX-PLAN 4.1). Winner on top at full width, the two runners-up
// side by side beneath, nothing with a minimum width the screen cannot
// honour — it renders unclipped at 320px.
export function Podium({ entries, stage = false }: { entries: LeaderboardEntry[]; stage?: boolean }) {
  const [first, second, third] = entries;
  if (!first) return null;

  if (!stage) {
    return (
      <div className="flex flex-col items-stretch gap-3 w-full">
        <WinnerCard entry={first} stage={false} />
        {(second || third) && (
          <div className="grid grid-cols-2 gap-3">
            {second && <RunnerUp entry={second} place={2} delay={0} stage={false} />}
            {third && <RunnerUp entry={third} place={3} delay={0.08} stage={false} />}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-stretch justify-center gap-6">
      {second && <RunnerUp entry={second} place={2} delay={PODIUM_STAGE_TIMING.second} stage />}

      <WinnerCard entry={first} stage />

      {third && <RunnerUp entry={third} place={3} delay={PODIUM_STAGE_TIMING.third} stage />}
    </div>
  );
}

// Every stage size below is a ladder step or rides the stage anchor: this is
// read from the back of the room like everything else projected (DESIGN.md §5,
// the 24px floor), and it is the one screen everybody is still looking at.
function WinnerCard({ entry: first, stage }: { entry: LeaderboardEntry; stage: boolean }) {
  const stageK = useStageScale();
  return (
    <motion.div
      initial={{ opacity: 0, y: 28, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // One of the three budgeted uses of the overshoot spring.
      transition={{ ...spring.pop, delay: stage ? PODIUM_STAGE_TIMING.winner : 0.26 }}
      className={cn(
        "relative overflow-hidden rounded-2xl flex flex-col items-center justify-center text-center",
        // Phone: full width of its column, no minimum the screen cannot honour.
        stage ? "px-14 py-8 min-w-[24rem] max-w-[56vw]" : "px-6 py-6 w-full min-w-0"
      )}
      style={{ background: paletteOf(first).solid, color: paletteOf(first).ink }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 0%, oklch(1 0 0 / .14), transparent 62%)" }}
      />
      <span className="relative flex flex-col items-center gap-3 min-w-0 max-w-full">
        {/* On the stage the label leads: the room reads WHAT this is before
            WHO, and the name is then the biggest thing on the screen. */}
        {stage && (
          <span className="text-stage-label font-semibold uppercase track-label opacity-80">
            Winner
          </span>
        )}
        <AvatarBubble avatar={first.avatar} size={stage ? Math.round(88 * stageK) : 56} />
        <span
          className={cn(
            "font-display font-bold leading-none truncate max-w-full",
            stage ? "text-stage-q-sm pb-[0.08em]" : "text-title2"
          )}
        >
          {first.name}
        </span>
        <span
          className={cn(
            "nums font-bold leading-none",
            stage ? "text-stage-answer" : "text-title1"
          )}
        >
          <NumberTicker value={first.score} />
        </span>
        {!stage && (
          <span className="text-caption2 font-semibold uppercase track-label opacity-70">
            Winner
          </span>
        )}
      </span>
    </motion.div>
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
  const stageK = useStageScale();
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.default, delay }}
      className={cn(
        "self-end rounded-xl bg-surface-1 shadow-elev-1 flex flex-col items-center text-center gap-2",
        // The phone card has no minimum width: it is one of two in a grid
        // that already divides whatever the screen has, and `min-w-0` is
        // what lets the name truncate instead of pushing the grid wider.
        stage ? "px-8 py-6 min-w-[16rem] max-w-[24vw]" : "px-4 py-4 min-w-0 self-stretch"
      )}
    >
      <span
        className={cn(
          "nums font-bold uppercase track-label text-ink-subtle",
          stage ? "text-stage-label" : "text-caption"
        )}
      >
        #{place}
      </span>
      <AvatarBubble avatar={entry.avatar} size={stage ? Math.round(64 * stageK) : 36} />
      <span
        className={cn(
          "font-ui font-semibold leading-tight text-ink truncate max-w-full",
          stage ? "text-stage-name" : "text-subhead"
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

/**
 * The rest of the board under the stage podium. Stage-only — the phone has
 * its own ending — so it is drawn on the stage ladder throughout.
 *
 * `firstPlace` is the rank of the first row: under a podium the list starts at
 * 4, because repeating the three people who are already on cards above it was
 * spending five of the room's eight readable rows on news it had just read.
 */
export function LeaderboardList({
  entries,
  firstPlace = 1,
  delay = 0,
}: {
  entries: LeaderboardEntry[];
  firstPlace?: number;
  delay?: number;
}) {
  const stageK = useStageScale();
  if (entries.length === 0) {
    return <p className="text-stage-label text-ink-subtle text-center py-6">No scores yet</p>;
  }
  return (
    <div className="flex flex-col gap-2 w-full">
      {entries.map((e, i) => (
        <motion.div
          key={pkeyOf(e)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: delay + i * 0.035, duration: 0.24 }}
          className="flex items-center justify-between gap-4 rounded-lg bg-surface-1 shadow-line px-6 py-2.5"
        >
          <span className="flex items-center gap-4 min-w-0">
            <span className="nums w-[2ch] text-right text-stage-label font-bold text-ink-subtle">
              {firstPlace + i}
            </span>
            <AvatarBubble avatar={e.avatar} size={Math.round(44 * stageK)} />
            <span className="text-stage-name font-semibold text-ink truncate">{e.name}</span>
          </span>
          <span className="nums text-stage-name font-bold text-ink-muted shrink-0">{e.score}</span>
        </motion.div>
      ))}
    </div>
  );
}
