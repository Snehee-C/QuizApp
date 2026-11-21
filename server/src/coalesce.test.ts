// Run with: npx tsx src/coalesce.test.ts
//
// The leading-edge-plus-trailing-frame throttle behind the per-submission
// broadcasts. Driven by a fake clock so the window arithmetic is exact.
import { createThrottle } from "./coalesce.js";

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

// A clock and a scheduler we drive by hand.
let clock = 0;
let timers: { at: number; fn: () => void; id: number }[] = [];
let nextId = 1;
function schedule(fn: () => void, ms: number) {
  const id = nextId++;
  timers.push({ at: clock + ms, fn, id });
  return id as unknown as ReturnType<typeof setTimeout>;
}
function clear(t: ReturnType<typeof setTimeout>) {
  timers = timers.filter((x) => x.id !== (t as unknown as number));
}
function advance(ms: number) {
  clock += ms;
  for (const t of [...timers].sort((a, b) => a.at - b.at)) {
    if (t.at <= clock) {
      timers = timers.filter((x) => x.id !== t.id);
      t.fn();
    }
  }
}

const sent: [number, string, number][] = [];
const th = createThrottle<number>(
  500,
  (key, payload) => sent.push([clock, key, payload]),
  { now: () => clock, schedule, clear }
);

// The first push in a burst goes immediately.
th.push("room", 1);
check("leading edge is immediate", sent, [[0, "room", 1]]);

// Everything inside the window collapses into ONE trailing frame carrying the
// newest payload, sent exactly when the window closes.
advance(100);
th.push("room", 2);
advance(100);
th.push("room", 3);
check("inside the window nothing is sent yet", sent.length, 1);
advance(299);
check("one ms before the window closes, still nothing", sent.length, 1);
advance(1);
check("trailing frame carries the newest payload", sent, [[0, "room", 1], [500, "room", 3]]);

// The trailing frame opens a fresh window: a push right after it waits again.
th.push("room", 4);
check("push right after the trailing frame is held", sent.length, 2);
advance(500);
check("...and lands when that window closes", sent[2], [1000, "room", 4]);

// Once the room is quiet for a window, the next push is leading-edge again.
advance(600);
th.push("room", 5);
check("quiet room: immediate again", sent[3], [1600, "room", 5]);

// Rooms are independent.
th.push("other", 9);
check("a second key has its own window", sent[4], [1600, "other", 9]);

// cancel() drops the pending frame rather than sending it.
th.push("room", 6);
check("held for the trailing frame", sent.length, 5);
th.cancel("room");
advance(1000);
check("cancelled frame never sends", sent.length, 5);

console.log(`\ncoalesce: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
