// Sound tokens — the audio half of DESIGN.md §1, "quiet system, loud moments".
//
// SOUND IS NEVER THE ONLY CHANNEL. Every cue here duplicates something the
// room can already see: "join" a bubble landing in the lobby, "tick" the last
// three pulses of the timer ring, "reveal" the tile choreography closing,
// "correct"/"wrong" the ✓/✕ stamp and the scale change, "podium" the winner
// flood and confetti, "riser" the arming line filling (standings) or the
// distribution bars spreading (reveal), "land" the rows settling into their
// new ranks with their +Δ chips, or the correct tile lifting. Muting the app
// must never cost a player information — most rooms run muted, and per the
// accessibility contract that is a supported configuration, not a degraded
// one. Do not add a cue that carries meaning on its own.
//
// Everything is synthesised from oscillators. The category's most dated
// signal is stock royalty-free loop music, and an asset-free kit also means
// the app still works on a venue LAN with no internet and adds zero bytes to
// the bundle. There are no audio files and no network requests in this file.
//
// House rules for the kit itself:
//   - short attack, hard stop: nothing rings past ~600ms except "podium"
//     and "riser", which are the two cues whose JOB is duration (see below)
//   - sine and triangle only; a square/saw buzzer is the Kahoot costume
//   - being wrong is never punished (P4) — "wrong" is soft, low and warm,
//     not a buzzer
//   - one harmonic plan across the kit, so the pair that frames a moment
//     actually resolves: "riser" climbs C→G (the dominant) and "land"
//     answers it with C. Suspense is a chord that has not come home yet.

export type SoundName =
  | "join"
  | "tick"
  | "reveal"
  | "correct"
  | "wrong"
  | "podium"
  | "riser"
  | "land";

export type SoundRole = "presenter" | "participant";

export interface InitSoundOptions {
  /**
   * Which surface is asking. This decides the DEFAULT mute state, and the
   * default is the whole point: a presenter laptop wired to the room PA
   * should be audible, but two hundred phones chiming in unison on every
   * join is a disaster and would get the sound switched off for good. So:
   * presenter defaults ON, participant defaults OFF.
   */
  role: SoundRole;
}

/* ── preference ─────────────────────────────────────────────────────── */

// Keyed by role: a host's laptop is routinely also a player (testing a deck,
// joining their own room), and those two surfaces want opposite defaults. One
// shared key would make the last surface visited overwrite the other.
const KEY_PREFIX = "floodlight_sound_";

let role: SoundRole = "participant";
let muted = true;
const listeners = new Set<() => void>();

function storageKey(r: SoundRole): string {
  return KEY_PREFIX + r;
}

/** localStorage throws in private-mode Safari and in sandboxed iframes. */
function readStored(r: SoundRole): boolean | null {
  try {
    const v = localStorage.getItem(storageKey(r));
    if (v === "on") return false;
    if (v === "off") return true;
  } catch {
    /* no persistence available — fall through to the role default */
  }
  return null;
}

function writeStored(r: SoundRole, value: boolean) {
  try {
    localStorage.setItem(storageKey(r), value ? "off" : "on");
  } catch {
    /* preference simply won't survive a reload */
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function defaultMuted(r: SoundRole): boolean {
  // reduce-motion is a request for less sensory load in general, not just
  // less movement — someone who asked for a calmer screen did not ask for a
  // noisier one. It only moves the DEFAULT; an explicit toggle still wins.
  if (prefersReducedMotion()) return true;
  return r === "participant";
}

/**
 * Declare which surface this is and resolve the starting mute state.
 * Safe to call more than once; a stored user choice always beats the default.
 */
export function initSound(options: InitSoundOptions): void {
  role = options.role;
  const stored = readStored(role);
  muted = stored ?? defaultMuted(role);
  emit();

  // The presenter defaults to unmuted, so its context has to be primed by
  // *some* gesture or the first cue of the session is silently swallowed.
  // One-shot, passive, and capture so it still fires for handlers that stop
  // propagation. The toggle also calls unlockAudio() directly.
  if (typeof window !== "undefined") {
    const prime = () => {
      unlockAudio();
    };
    const opts = { once: true, passive: true, capture: true } as const;
    window.addEventListener("pointerdown", prime, opts);
    window.addEventListener("keydown", prime, opts);
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  if (muted === value) return;
  muted = value;
  writeStored(role, value);
  emit();
}

/** Returns the new muted state, for callers that want to echo it. */
export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

export function getSoundRole(): SoundRole {
  return role;
}

/** Subscribe form so React can drive a control with useSyncExternalStore. */
export function subscribeMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const l of listeners) l();
}

/* ── context ────────────────────────────────────────────────────────── */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
// Once construction has failed there is no point retrying on every cue —
// a browser without Web Audio will not grow it mid-session.
let unavailable = false;

type AudioContextCtor = new () => AudioContext;

function getCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Create (or resume) the single AudioContext. MUST be called from inside a
 * user-gesture handler — click, tap, keydown. Constructing one before a
 * gesture gives you a context stuck in "suspended" that some browsers will
 * not revive, so we never build it speculatively; until this runs, every cue
 * is a silent no-op.
 *
 * Idempotent and never throws.
 */
export function unlockAudio(): void {
  if (unavailable) return;
  try {
    if (!ctx) {
      const Ctor = getCtor();
      if (!Ctor) {
        unavailable = true;
        return;
      }
      ctx = new Ctor();
      master = ctx.createGain();
      // Headroom: cues stack (a correct stamp landing over a tick) and the
      // presenter is usually on a PA whose own gain is already generous.
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    unavailable = true;
    ctx = null;
    master = null;
  }
}

/* ── voices ─────────────────────────────────────────────────────────── */

interface Note {
  /** Hz. */
  f: number;
  /** Seconds from the start of the cue. */
  at: number;
  /** Seconds. Includes the release; the voice is hard-stopped at the end. */
  dur: number;
  /** Peak linear gain, pre-master. */
  peak: number;
  type?: OscillatorType;
  /** Glide to this frequency across the note — a cheap sense of direction. */
  to?: number;
  /**
   * Invert the envelope: ramp UP to `peak` across the whole note instead of
   * decaying from it. Every other cue in the kit is percussive — struck, then
   * gone — which is exactly wrong for suspense, because a sound that is
   * already dying cannot promise anything. A swell plus a `to` glide is the
   * entire riser: it gets louder and higher and then stops, and the stopping
   * is what the resolve lands into.
   */
  swell?: boolean;
}

// Attack is deliberately not zero: a 4ms ramp from silence removes the click
// that an abrupt gain step puts on a phone speaker, and is short enough to
// still read as percussive.
const ATTACK = 0.004;
const MIN_GAIN = 0.0001;
// Where a swelling note STARTS, as a fraction of its peak. See voice().
const SWELL_FLOOR = 0.06;

function voice(context: AudioContext, out: GainNode, n: Note, t0: number) {
  const start = t0 + n.at;
  const end = start + n.dur;

  const osc = context.createOscillator();
  osc.type = n.type ?? "sine";
  osc.frequency.setValueAtTime(n.f, start);
  if (n.to !== undefined) {
    // Exponential, not linear: pitch is perceived logarithmically, so a
    // linear sweep sounds like it slows down as it rises.
    osc.frequency.exponentialRampToValueAtTime(Math.max(n.to, 1), end);
  }

  const g = context.createGain();
  g.gain.setValueAtTime(MIN_GAIN, start);
  if (n.swell) {
    // Crescendo across the note, then a short release so the cut is not a
    // click. Exponential on the way up too, for the same reason the pitch
    // glide is: loudness is perceived logarithmically, and a linear swell
    // sounds like it stops growing halfway.
    //
    // It climbs from SWELL_FLOOR, not from silence. Ramping exponentially all
    // the way up from the 0.0001 floor spends almost the whole note inaudible
    // — rendered offline, a 1.15s riser was still at 1.5% of its peak at the
    // halfway mark, so the build only existed in its last third and the room
    // heard a lurch rather than a build. From 6% it is a ~24dB rise that is
    // present from the first beat and grows the whole way.
    const tail = Math.min(0.06, n.dur * 0.12);
    const floor = Math.max(MIN_GAIN, n.peak * SWELL_FLOOR);
    g.gain.linearRampToValueAtTime(floor, start + Math.min(ATTACK, n.dur / 2));
    g.gain.exponentialRampToValueAtTime(n.peak, end - tail);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, end);
  } else {
    g.gain.linearRampToValueAtTime(n.peak, start + Math.min(ATTACK, n.dur / 2));
    // Exponential decay reads as a natural release; it cannot reach zero, so a
    // setValueAtTime floor plus osc.stop() does the hard cut the kit promises.
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, end);
  }
  g.gain.setValueAtTime(0, end);

  osc.connect(g);
  g.connect(out);
  osc.start(start);
  osc.stop(end + 0.01);
  // Nodes are single-use; without this a long session leaks one graph per cue.
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

/* ── the kit ────────────────────────────────────────────────────────── */
//
// Equal-tempered frequencies, written out rather than computed so the
// intervals are readable. Everything is C major or a fragment of it: the kit
// has to survive two cues landing on top of each other.

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const G4 = 392.0;
const C4 = 261.63;
const A3 = 220.0;
const G3 = 196.0;
const F3 = 174.61;
const E6 = 1318.51;

// Three rising steps, one per remaining second. Pitch rising with urgency is
// the same information the ring's accent→rose shift carries visually.
const TICK_STEPS = [G5, C6, E6];

const C3 = 130.81;

/**
 * The suspense bed. Three octaves of C climbing a fifth to G across whatever
 * beat it has been given, all three swelling.
 *
 * Why it is built rather than written out: the two moments that need it are
 * different lengths (the standings arm + run is ~2.05s, the reveal's close +
 * spread is ~860ms) and a riser that ends before its beat does is worse than
 * no riser — it tells the room the moment is over while the screen is still
 * moving. One cue that stretches beats two cues that do not fit.
 *
 * The shimmer voice enters a third of the way in rather than at the top. A
 * riser that starts with everything already sounding has nowhere left to go;
 * adding a voice partway is how the build keeps building after the glide has
 * used up most of its range.
 */
function riserNotes(dur: number): Note[] {
  const d = Math.max(0.35, Math.min(2.6, dur));
  return [
    { f: C3, at: 0, dur: d, peak: 0.055, swell: true, to: G3 },
    { f: C4, at: 0, dur: d, peak: 0.08, swell: true, to: G4 },
    { f: C5, at: d * 0.34, dur: d * 0.66, peak: 0.045, swell: true, to: G5, type: "triangle" },
  ];
}

const KIT: Record<SoundName, Note[]> = {
  // Low and short so a lobby filling at four joins a second is a texture,
  // not an alarm. A fifth, because thirds get muddy down here.
  join: [
    { f: G3, at: 0, dur: 0.14, peak: 0.1 },
    { f: C4, at: 0.015, dur: 0.16, peak: 0.07 },
  ],

  // Declared for completeness; the live notes come from tickNotes(), which
  // picks the step so the three ticks rise across the countdown.
  tick: [{ f: TICK_STEPS[0], at: 0, dur: 0.07, peak: 0.1, type: "triangle" }],

  // V→I. The shortest figure that sounds like an answer arriving rather than
  // a notification firing. Lands inside the reveal's 900ms choreography.
  reveal: [
    { f: G4, at: 0, dur: 0.13, peak: 0.11, type: "triangle" },
    { f: C5, at: 0.1, dur: 0.22, peak: 0.13, type: "triangle" },
    { f: G5, at: 0.1, dur: 0.22, peak: 0.05 },
  ],

  // Up a fifth, bright. Private to one phone, so it can be the most
  // confident thing in the kit.
  correct: [
    { f: C5, at: 0, dur: 0.1, peak: 0.13, type: "triangle" },
    { f: G5, at: 0.08, dur: 0.17, peak: 0.13, type: "triangle" },
  ],

  // P4: incorrect is "desaturate and dim", never a punishment — so this is
  // the visual rule in audio. A gentle whole-tone fall in the low register,
  // sine only, quieter than "correct", with no dissonance to flinch at. It
  // should read as "that one went past", not "WRONG".
  wrong: [
    { f: A3, at: 0, dur: 0.18, peak: 0.075, to: G3 },
    { f: F3, at: 0.09, dur: 0.24, peak: 0.055 },
  ],

  // The one cue allowed to take its time (~1.1s) — it is the single biggest
  // emotional moment in the product and fires once per session, under the
  // avatar-hue flood and the two confetti bursts. Arpeggio up, then the
  // octave held with its fifth underneath so it lands rather than stops.
  podium: [
    { f: C5, at: 0, dur: 0.16, peak: 0.12, type: "triangle" },
    { f: E5, at: 0.11, dur: 0.16, peak: 0.12, type: "triangle" },
    { f: G5, at: 0.22, dur: 0.18, peak: 0.12, type: "triangle" },
    { f: C6, at: 0.34, dur: 0.76, peak: 0.14, type: "triangle" },
    { f: G4, at: 0.34, dur: 0.76, peak: 0.06 },
  ],

  // Declared for completeness; the live notes come from riserNotes(), which
  // stretches the cue to whatever beat it is sitting under.
  riser: riserNotes(1.15),

  // The resolve. The riser leaves the room on G — the dominant, which is the
  // sound of an unanswered question — and this is the C that answers it.
  // Struck as one chord rather than rolled, because it marks an INSTANT (the
  // rows landing, the correct tile lifting) and an arpeggio would smear it
  // across 300ms. Deliberately not "podium": that one is a session ending,
  // this one happens five or six times a round and must not wear out.
  land: [
    { f: C4, at: 0, dur: 0.44, peak: 0.08 },
    { f: C5, at: 0, dur: 0.4, peak: 0.12, type: "triangle" },
    { f: E5, at: 0.01, dur: 0.4, peak: 0.09, type: "triangle" },
    { f: G5, at: 0.02, dur: 0.38, peak: 0.07, type: "triangle" },
  ],
};

/* ── playback ───────────────────────────────────────────────────────── */

let tickIndex = 0;
let lastTickAt = 0;
// A countdown tick comes once a second; anything slower is a new countdown,
// so the ladder resets rather than running off the top.
const TICK_RESET_MS = 1800;

function tickNotes(step?: number): Note[] {
  let i: number;
  if (step !== undefined) {
    i = Math.max(0, Math.min(TICK_STEPS.length - 1, Math.floor(step)));
  } else {
    const now = Date.now();
    if (now - lastTickAt > TICK_RESET_MS) tickIndex = 0;
    lastTickAt = now;
    i = Math.min(tickIndex, TICK_STEPS.length - 1);
    tickIndex = i + 1;
  }
  return [{ f: TICK_STEPS[i], at: 0, dur: 0.07, peak: 0.1, type: "triangle" }];
}

export interface PlayOptions {
  /**
   * "tick" only: which of the three countdown steps to sound (0 = lowest).
   * Omit and consecutive ticks walk up on their own, resetting after a
   * second and a half of silence.
   */
  step?: number;
  /**
   * "riser" only: seconds, clamped to 0.35–2.6. Pass the length of the beat
   * the riser is sitting under, so the build and the picture end together.
   */
  duration?: number;
}

/**
 * Fire a cue. Silent — never throwing — when muted, when Web Audio is
 * missing, or before unlockAudio() has run inside a user gesture.
 */
export function playSound(name: SoundName, options?: PlayOptions): void {
  if (muted || unavailable || !ctx || !master) return;
  try {
    if (ctx.state === "suspended") {
      // Lost the context to a tab switch or an OS interruption. Ask for it
      // back for next time, but don't schedule into a stopped clock.
      void ctx.resume();
      return;
    }
    const notes =
      name === "tick"
        ? tickNotes(options?.step)
        : name === "riser"
          ? riserNotes(options?.duration ?? 1.15)
          : KIT[name];
    // A hair in the future: scheduling at exactly currentTime can land in a
    // block the audio thread has already rendered, which clips the attack.
    const t0 = ctx.currentTime + 0.001;
    for (const n of notes) voice(ctx, master, n, t0);
  } catch {
    /* a cue is never worth breaking the round over */
  }
}
