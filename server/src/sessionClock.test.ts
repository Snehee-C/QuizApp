// Run with: npx tsx src/sessionClock.test.ts
//
// Covers the clock arithmetic a live session scores on, and the one scoring
// fail-safe that turned out to be a blocker. Nothing here needs a database.
import { monoFromWall } from "./sessionClock.js";
import { speedPoints, MAX_POINTS, MIN_POINTS } from "./slides/types.js";

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}

// ── Wall clock onto the monotonic scale ────────────────────────────────────

// Stamped 5s ago by the wall clock, so 5s ago on the monotonic one too.
check("mono: five seconds ago", monoFromWall(10_000, 15_000, 900_000), 895_000);
check("mono: this instant", monoFromWall(15_000, 15_000, 900_000), 900_000);

// A row stamped in the FUTURE — a clock step between two processes — must read
// as "just now". Without the clamp it reads as a NEGATIVE elapsed, which hands
// its owner more than a full scoring window.
check("mono: future stamp clamps to now", monoFromWall(20_000, 15_000, 900_000), 900_000);

// ── The fail-safe that became a blocker ────────────────────────────────────
//
// `speedPoints` treats a missing start as instant, deliberately: a player must
// never be charged for a clock the server lost. Right per answer, ruinous per
// room — when audience arrivals stopped surviving a restart, EVERY correct
// answer took this branch and scored full marks. The fail-safe stays; these
// cases pin what it actually does, so the next person to lose a clock finds it
// written down rather than inferring it from a leaderboard.

const at = (now: number, startedAt: number | null) =>
  speedPoints(20, { now, slideStartedAt: startedAt } as any);

check("no clock at all scores FULL marks", at(50_000, null), MAX_POINTS);
check("answering instantly scores full marks", at(10_000, 10_000), MAX_POINTS);

// Half the window used: halfway between the floor and the ceiling.
check("half the window", at(20_000, 10_000), Math.round((MAX_POINTS + MIN_POINTS) / 2));

// Using the whole window scores the floor...
check("the whole window", at(30_000, 10_000), MIN_POINTS);

// ...and so does arriving AFTER it, which is what makes the grace free: an
// answer admitted by it scores exactly what the slowest honest answer scores,
// never more. The grace recovers the answer, never the speed bonus.
check("past the deadline is floored, not negative", at(30_750, 10_000), MIN_POINTS);
check("far past the deadline is still the floor", at(120_000, 10_000), MIN_POINTS);

console.log(`\nsessionClock: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
