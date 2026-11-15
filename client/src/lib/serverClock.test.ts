// Run with: npx tsx src/lib/serverClock.test.ts
//
// The filter in serverClock.ts decides which of several disagreeing samples
// this device believes about the server's clock, and every countdown in the
// app is read through it. It is also the kind of code that looks obviously
// right and is quietly wrong in one branch, so each rule gets a case.
import {
  clockDebug,
  hasServerClock,
  noteServerNow,
  resetServerClock,
  serverNow,
} from "./serverClock.js";

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
/** Offsets are derived from a live `Date.now()`, so compare with slack. */
function near(name: string, got: number, want: number, slack = 25) {
  const ok = Math.abs(got - want) <= slack;
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}\n  got  ${got}\n  want ${want} (±${slack})`);
  }
}

// Freeze the clock so a sample's arithmetic is exact and the drift case can be
// aged without the test taking a minute to run.
const realNow = Date.now;
let fake = 1_700_000_000_000;
function at(t: number) {
  fake = t;
}
Date.now = () => fake;

try {
  // --- honest when it knows nothing ---
  resetServerClock();
  check("unsynced: hasServerClock", hasServerClock(), false);
  check("unsynced: serverNow is Date.now", serverNow(), fake);
  check("unsynced: debug", clockDebug().synced, false);

  // --- garbage leaves us exactly as we were ---
  noteServerNow(undefined);
  noteServerNow(null);
  noteServerNow("12345");
  noteServerNow(NaN);
  noteServerNow(Infinity);
  check("garbage never syncs", hasServerClock(), false);

  // --- the first sample is adopted whatever it looks like ---
  resetServerClock();
  // Server is 10s ahead; the reply took 200ms, so half of it has already
  // elapsed and the true offset is 10s + 100ms.
  noteServerNow(fake + 10_000, 200);
  near("first sample: offset", clockDebug().offsetMs, 10_100);
  near("first sample: serverNow", serverNow(), fake + 10_100);
  check("first sample: rtt recorded", clockDebug().rttMs, 200);

  // --- a cleaner trip refines it, even though it disagrees ---
  noteServerNow(fake + 10_000, 20);
  near("better rtt wins: offset", clockDebug().offsetMs, 10_010);
  check("better rtt wins: rtt", clockDebug().rttMs, 20);

  // --- a dirtier trip is rejected: latest must NOT beat best ---
  const held = clockDebug().offsetMs;
  noteServerNow(fake + 10_000, 1_500);
  check("worse rtt loses: offset unchanged", clockDebug().offsetMs, held);
  check("worse rtt loses: rtt unchanged", clockDebug().rttMs, 20);

  // --- an untimed broadcast cannot displace a measured sample ---
  noteServerNow(fake + 10_000);
  check("broadcast loses to measurement", clockDebug().offsetMs, held);

  // --- ...but IS good enough when it is all we have ---
  resetServerClock();
  noteServerNow(fake + 4_000);
  check("broadcast syncs from cold", hasServerClock(), true);
  // REGRESSION GUARD. The nominal rtt an untimed sample is RANKED at must
  // never be spent as a half-trip CORRECTION: nobody timed this trip, so the
  // only honest shift is zero. Briefly it was corrected by 500ms, which drifted
  // a perfect clock by up to 460ms in the direction that shows a player less
  // time than they have.
  near("broadcast is ranked low but NOT corrected", clockDebug().offsetMs, 4_000, 2);

  // --- a tie refreshes rather than locking onto a lucky packet ---
  resetServerClock();
  noteServerNow(fake + 1_000, 50);
  const firstCount = clockDebug().samples;
  noteServerNow(fake + 1_000, 50);
  check("equal rtt is accepted", clockDebug().samples, firstCount + 1);

  // --- a clock being RE-SET is adopted at once, however dirty the trip ---
  resetServerClock();
  noteServerNow(fake + 1_000, 10); // a very clean sample we would normally keep
  noteServerNow(fake + 90_000, 1_800); // ...and a filthy one that disagrees hugely
  near("step: adopted immediately", clockDebug().offsetMs, 90_900);
  check("step: error bar replaced", clockDebug().rttMs, 1800);

  // --- but latency alone can never forge a step ---
  resetServerClock();
  noteServerNow(fake + 1_000, 10);
  // 4s of disagreement is under the threshold, so this is read as a bad
  // packet and rejected rather than believed.
  noteServerNow(fake + 5_000, 900);
  near("sub-threshold disagreement is rejected", clockDebug().offsetMs, 1_005);

  // --- drift: a held sample stops being authoritative after a minute ---
  resetServerClock();
  noteServerNow(fake + 1_000, 10);
  at(fake + 61_000); // more than SAMPLE_TTL_MS later
  noteServerNow(fake + 1_400, 600); // worse rtt, and it should STILL win now
  near("drift: stale best is replaced", clockDebug().offsetMs, 1_700);
  check("drift: competition reopened", clockDebug().rttMs, 600);

  // --- ...and a fresh one is not ---
  resetServerClock();
  noteServerNow(fake + 1_000, 10);
  at(fake + 5_000);
  noteServerNow(fake + 1_400, 600);
  near("fresh best is kept", clockDebug().offsetMs, 1_005);

  // --- REGRESSION GUARD: age alone must not open the door to anything ---
  //
  // The escape this replaced was "older than a minute, take the next sample
  // whatever it is". Because `bestRttMs` only ratchets DOWN, one lucky early
  // packet rejected every honest probe after it, the held sample went stale on
  // schedule, and whatever arrived next was adopted unconditionally — a
  // delayed untimed broadcast included. The bar now rises with age instead, so
  // a challenger still has to be good enough; there is just a moment when
  // "good enough" means something looser.
  resetServerClock();
  noteServerNow(fake + 1_000, 10);
  at(fake + 30_000); // half a TTL: bar has risen to ~510ms
  // Deliberately within STEP_THRESHOLD_MS of what we hold: a bigger
  // disagreement would be adopted by the step escape (correctly, and as the
  // "step" case above already checks), and would tell us nothing about the bar.
  noteServerNow(fake + 3_000); // untimed, ranked 1000 — still not good enough
  near("stale-but-not-ancient: broadcast still loses", clockDebug().offsetMs, 1_005);

  // --- ...but a measured probe clears the risen bar, so the loop refreshes ---
  //
  // The 25s sync loop must never be locked out by one lucky sample. Two
  // seconds of ageing lifts a 10ms bar past 30ms, which is the realistic
  // spread between two probes on the same link.
  resetServerClock();
  noteServerNow(fake + 1_000, 10);
  at(fake + 2_000);
  noteServerNow(fake + 1_200, 30);
  near("ageing lets an honest probe refresh", clockDebug().offsetMs, 1_215);
  check("ageing: rtt updated", clockDebug().rttMs, 30);

  // --- ...and a genuinely silent clock does eventually yield to broadcasts ---
  //
  // Against a server with no `time:sync` at all, broadcasts are the ONLY
  // samples that will ever arrive. They must not be locked out forever, or the
  // offset freezes on first contact and never tracks drift again.
  resetServerClock();
  noteServerNow(fake + 1_000, 10);
  at(fake + 70_000); // past a full TTL: bar is now ~1177ms
  noteServerNow(fake + 1_900);
  near("long silence: broadcast finally wins", clockDebug().offsetMs, 1_900, 2);
} finally {
  Date.now = realNow;
}

console.log(`\n${pass} passed, ${fail} failed`);
// Thrown rather than `process.exit`: this file is typechecked by the CLIENT's
// tsconfig, which has no node types, and a non-zero exit is what a runner
// wants either way — an uncaught throw gives it one.
if (fail > 0) throw new Error(`${fail} serverClock assertion(s) failed`);
