import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { clockDebug } from "../lib/serverClock";

/**
 * What this device thinks the server's clock is, on screen.
 *
 * The skew between the stage and the phones was invisible for as long as it
 * existed, and that is most of why it survived: every screen in the room was
 * confidently counting down, each one correct about its own clock, and the
 * only evidence anything was wrong was a presenter saying "it feels off". An
 * offset you cannot read is an offset you cannot argue about.
 *
 * So this is the instrument, not a feature. It renders nothing at all unless
 * it is explicitly turned on, and nothing anywhere in the app branches on it.
 *
 * TURNING IT ON: add `?clock=1` to the URL of any presenter or player screen —
 * INSIDE the hash, as in `/#/join/ABCD?clock=1`. The choice is remembered per
 * device, because the screen you most need it on is a phone that has since
 * navigated somewhere the query string did not survive. `?clock=0` turns it
 * off again.
 *
 * The query is read from `useLocation()`, not from `window.location.search`.
 * This app is served from static hosting and routes on the hash (main.tsx), so
 * everything after `#` — the path AND its query — is invisible to
 * `window.location.search`, which sees only what precedes the `#`. Read from
 * there, the documented URL above switched this on exactly never: the search
 * string was empty, and the one spelling that did populate it
 * (`/join/X?clock=1`, no hash) routed to `/`, where this renders nothing
 * anyway. A diagnostic with no working way to turn it on is not a diagnostic.
 *
 * READING IT. `offset` is `serverClock - deviceClock`: positive means this
 * device is BEHIND the server, negative means ahead. `rtt` is the round trip
 * of the sample that offset came from, which is its error bar — the true
 * offset is within about ±rtt/2 of what is shown. `age` is how long ago that
 * sample was accepted; it climbing past a minute means the filter has stopped
 * finding anything cleaner, which is normal on a quiet link.
 *
 * THE TEST THIS EXISTS FOR: open it on the presenter and on a phone at the
 * same time. The two `offset` readings will differ — they are different
 * devices with different clocks. What must AGREE is `server`: that is each
 * device's corrected read of the one clock the countdown is measured against,
 * and if the two disagree by more than a few hundred milliseconds then the
 * room is not running a fair question, whatever the rings say.
 */

const KEY = "menti_clock_debug";

function enabled(search: string): boolean {
  const q = new URLSearchParams(search).get("clock");
  try {
    if (q === "1") {
      localStorage.setItem(KEY, "1");
      return true;
    }
    if (q === "0") {
      localStorage.removeItem(KEY);
      return false;
    }
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Private-mode Safari throws on localStorage. The query string still
    // works for this page load, which is all a diagnostic needs.
    return q === "1";
  }
}

function ms(n: number): string {
  const s = n / 1000;
  return `${s >= 0 ? "+" : ""}${s.toFixed(3)}s`;
}

export function ClockDebug() {
  const { pathname, search } = useLocation();
  const [on] = useState(() => enabled(search));
  const [, bump] = useState(0);

  useEffect(() => {
    if (!on) return;
    // Twice a second. Fast enough to watch a burst land, slow enough that the
    // diagnostic is never the reason a frame was dropped.
    const t = setInterval(() => bump((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [on]);

  // Which screen this is, so a photo of two devices side by side is readable
  // without having to remember which one was which.
  //
  // And ONLY these two. The stage and the player screen are the only ones that
  // run `startClockSync`, so anywhere else the honest reading is "no sample
  // has arrived" — which this panel would render, correctly and in red, as
  // UNSYNCED. Someone switching the diagnostic on and landing on the dashboard
  // would read that as the fix having failed. A diagnostic that cries wolf on
  // the screens it does not cover is worse than one that stays quiet there.
  const label = pathname.startsWith("/present")
    ? "STAGE"
    : pathname.startsWith("/join")
      ? "PHONE"
      : null;

  if (!on || !label) return null;

  const d = clockDebug();
  const corrected = Date.now() + d.offsetMs;
  // An unsynced screen is the failure this was built to catch, so it is the
  // one state that gets a colour.
  const colour = d.synced ? "var(--ink)" : "var(--danger)";

  return (
    <div
      // Bottom-left: the bottom-right corner is where this app puts real
      // controls on both screens, and a diagnostic must never sit on top of
      // something a host is about to press in front of a room.
      className="fixed bottom-2 left-2 z-[9999] rounded-md px-2 py-1 font-mono text-[11px] leading-tight shadow-lg"
      style={{ background: "var(--surface-2)", color: colour, opacity: 0.92 }}
      role="status"
      aria-live="off"
    >
      <div style={{ fontWeight: 700 }}>
        {label} {d.synced ? "" : "· UNSYNCED"}
      </div>
      <div>server {new Date(corrected).toISOString().slice(11, 23)}</div>
      <div>
        offset {ms(d.offsetMs)} · rtt {d.rttMs === null ? "—" : `${Math.round(d.rttMs)}ms`}
      </div>
      <div>
        age {d.ageMs === null ? "—" : `${Math.round(d.ageMs / 1000)}s`} · samples {d.samples}
      </div>
    </div>
  );
}
