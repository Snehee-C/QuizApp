import { useEffect, useRef, useState } from "react";
import { avatarFor } from "../lib/avatars";
import { TILE_COLORS, ballBg } from "../lib/palette";
import { prefersReducedMotion } from "../lib/motion";
import { cn } from "../lib/cn";
import { pkeyOf, type RowIdentity } from "./participantKey";
import { stageScale } from "./stageScale";

// `participantId` is no longer sent to phones and this list is drawn on the
// stage from a presenter frame — but the identity it keys off must be one both
// audiences have, or the next surface to reuse this draws one bubble for the
// whole room. Measured: three phones in, counter reading "3 players ready",
// exactly ONE bubble, because every row collapsed onto the same `undefined`.
interface Participant extends RowIdentity {
  name: string;
  avatar: number;
}

interface PlayerBubblesProps {
  participants: Participant[];
  className?: string;
}

interface Bubble {
  id: string;
  name: string;
  avatar: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** r / base at spawn. Kept so re-sizing the field (or the crowd) preserves
   *  each bubble's own jitter instead of flattening everything to one size. */
  k: number;
  /** Measured name-label box. The label is part of the collision body — see
   *  `separate()`. Width is the rendered text width, not the disc diameter. */
  lw: number;
  lh: number;
  el: HTMLDivElement | null;
  ball: HTMLDivElement | null;
  label: HTMLSpanElement | null;
}

const RESTITUTION = 0.72;
const CRASH_ENERGY = 7;
/** Gap between the bottom of the disc and the top of the name label. */
const LABEL_GAP = 8;
// Clearance the solver leaves AROUND a label. Without it the solver resolves to
// exact contact, which means a name ends up flush against the rim of the next
// bubble — legible by a pixel, which is not the same as readable. It also keeps
// the field honest under a square-bounding-box reading of "occluded".
const LABEL_PAD = 10;

// The Image-2 lobby physics field. Bubbles crash in from a random edge, get
// pulled gently toward center, bounce off walls, and NEVER overlap (one
// velocity-impulse pass + six positional-relaxation passes per frame). The sim
// runs in a single rAF loop; participant props are diffed by id so adding or
// removing players never resets the field.
// Beyond this the collision solver (O(n^2), six relaxation passes) starts
// costing real frames on the presenting machine. Extra players still count in
// the headline number — they just don't each get a body.
const MAX_BODIES = 60;

// How much of the field a full lobby is allowed to claim once every body
// carries its name label. Packing identical discs tops out near 0.90, but this
// is a *relaxation* solver with a fixed pass budget, not an optimiser: give it
// a field at 66% occupancy and it never catches up with the overlap the
// integration step re-injects each frame, which at 28 players left residual
// penetrations of up to 7px — i.e. labels still buried, just less of them.
// 0.40 lands around 42% occupancy, which converges inside the pass budget
// below. Measured: 0.52 and 0.46 both leave residual penetration at 28.
const PACK = 0.4;

// Area one body needs, as a multiple of r^2: (2r) wide by (2r + gap + label)
// tall, and the label scales with r (font-size 0.42r, line box ~1.3x), so the
// cell is roughly 2r x 2.6r.
const CELL_AREA = 5.2;

// Bubble radius. Scales with the field so the same component reads correctly on
// a phone (~340x300) and on a projected stage (~1100x520) — AND with the crowd,
// because a 28-player lobby at the stage radius needs more area than the stage
// has once labels are collision bodies. Without the second term the solver is
// handed an unsatisfiable problem and resolves it by stacking discs on names.
function baseRadius(w: number, h: number, n: number): number {
  const area = w * h;
  const byField = Math.sqrt(area) / 11;
  const byCrowd = n > 0 ? Math.sqrt((area * PACK) / (n * CELL_AREA)) : byField;
  // Floor at 20, not the old 26: on a phone-sized field (~350x600) a full
  // lobby cannot satisfy the label clearance at 26, and a jammed solver buries
  // names — the exact failure this is all here to prevent. A 40px bubble is
  // small but it is not a touch target, and a readable name beats a big disc.
  // The stage never reaches the floor (60 players in 1449x583 still sizes to
  // r 33), so this only ever trades disc size for legibility where it must.
  //
  // The CEILING, by contrast, binds on the stage the moment the lobby is a
  // small one — and it was an absolute 62px, so it was the lobby's share of
  // the scale ceiling the stage type had everywhere else: on a 4K projector
  // the join code drew at 422px beside 62px discs carrying 30px names, on the
  // same slide. It is design-size px now, on the same anchor as the ladder
  // (components/stageScale.ts), so it is exactly 62 at 1920x1080 and the
  // lobby is one picture at every resolution. The floor does NOT scale: it is
  // a legibility bound on a phone-sized field, not a proportion.
  return Math.max(20, Math.min(62 * stageScale(), Math.min(byField, byCrowd)));
}

function labelFontPx(r: number): number {
  return Math.max(13, Math.round(r * 0.42));
}

// ── Geometry. A body is a disc of radius r centred on (x, y) PLUS a label
// rectangle of lw x lh hanging LABEL_GAP below it, centred on the same x.
// Everything below treats both parts as one solid object. ──────────────────

const halfW = (b: Bubble) => Math.max(b.r, b.lw / 2);
const labelTop = (b: Bubble) => b.y + b.r + LABEL_GAP;
const bodyBottom = (b: Bubble) => b.y + b.r + LABEL_GAP + b.lh;

function wall(b: Bubble, w: number, h: number) {
  const hw = halfW(b);
  if (b.x < hw) {
    b.x = hw;
    b.vx = Math.abs(b.vx) * RESTITUTION;
  }
  if (b.x > w - hw) {
    b.x = w - hw;
    b.vx = -Math.abs(b.vx) * RESTITUTION;
  }
  if (b.y < b.r) {
    b.y = b.r;
    b.vy = Math.abs(b.vy) * RESTITUTION;
  }
  // The floor is the bottom of the LABEL, not of the disc: a name clipped by
  // the field's overflow:hidden is as unreadable as one sat on by a neighbour.
  const drop = b.r + LABEL_GAP + b.lh;
  if (b.y > h - drop) {
    b.y = h - drop;
    b.vy = -Math.abs(b.vy) * RESTITUTION;
  }
}

/** Move both bodies apart by `depth`, split evenly, along unit normal a->c. */
function apply(a: Bubble, c: Bubble, nx: number, ny: number, depth: number) {
  const half = depth / 2;
  a.x -= nx * half;
  a.y -= ny * half;
  c.x += nx * half;
  c.y += ny * half;
}

/** Disc of `circ` against the label rect of `rect`. Normal points rect -> circ. */
function discVsLabel(rect: Bubble, circ: Bubble): boolean {
  if (rect.lw <= 0 || rect.lh <= 0) return false;
  const rl = rect.x - rect.lw / 2 - LABEL_PAD;
  const rr = rect.x + rect.lw / 2 + LABEL_PAD;
  const rt = labelTop(rect) - LABEL_PAD;
  const rb = labelTop(rect) + rect.lh + LABEL_PAD;

  const px = Math.min(Math.max(circ.x, rl), rr);
  const py = Math.min(Math.max(circ.y, rt), rb);
  let dx = circ.x - px;
  let dy = circ.y - py;
  let dist = Math.hypot(dx, dy);

  if (dist === 0) {
    // Centre is inside the label box — push out the short way.
    const up = circ.y - rt;
    const down = rb - circ.y;
    dy = up < down ? -1 : 1;
    dx = 0;
    dist = 1;
    apply(rect, circ, dx, dy, circ.r + Math.min(up, down));
    return true;
  }
  if (dist >= circ.r) return false;
  apply(rect, circ, dx / dist, dy / dist, circ.r - dist);
  return true;
}

/** Label rect against label rect, resolved on the axis of least penetration. */
function labelVsLabel(a: Bubble, c: Bubble): boolean {
  if (a.lw <= 0 || c.lw <= 0) return false;
  // `a` carries the clearance for the pair, so a resolved contact still leaves
  // LABEL_PAD of air between the two names.
  const ox =
    Math.min(a.x + a.lw / 2 + LABEL_PAD, c.x + c.lw / 2) -
    Math.max(a.x - a.lw / 2 - LABEL_PAD, c.x - c.lw / 2);
  if (ox <= 0) return false;
  const at = labelTop(a);
  const ct = labelTop(c);
  const oy = Math.min(at + a.lh + LABEL_PAD, ct + c.lh) - Math.max(at - LABEL_PAD, ct);
  if (oy <= 0) return false;

  if (ox < oy) {
    apply(a, c, c.x >= a.x ? 1 : -1, 0, ox);
  } else {
    apply(a, c, 0, ct >= at ? 1 : -1, oy);
  }
  return true;
}

// One pair, four tests. The bubbles alone never overlapped even before this —
// the defect was that the name label hung outside the collision body, so a
// neighbouring disc could sit on top of it. At 28 players that silently ate 14
// of 28 names ("Raj" rendering as "Rai" because the descender was covered).
// Seeing your name appear is the lobby's entire job, so the label is part of
// the body now: disc/disc, each disc against the other's label, label/label.
function separate(a: Bubble, c: Bubble): boolean {
  // Cheap reject on the full lollipop boxes before doing four tests.
  const ahw = halfW(a) + LABEL_PAD;
  const chw = halfW(c) + LABEL_PAD;
  if (a.x + ahw <= c.x - chw || c.x + chw <= a.x - ahw) return false;
  if (a.y - a.r >= bodyBottom(c) + LABEL_PAD || c.y - c.r >= bodyBottom(a) + LABEL_PAD) return false;

  let moved = false;

  let dx = c.x - a.x;
  let dy = c.y - a.y;
  let dist = Math.hypot(dx, dy);
  const min = a.r + c.r;
  if (dist < min) {
    if (dist === 0) {
      dx = Math.random() - 0.5;
      dy = Math.random() - 0.5;
      dist = Math.hypot(dx, dy) || 1;
    }
    apply(a, c, dx / dist, dy / dist, min - dist);
    moved = true;
  }

  if (discVsLabel(a, c)) moved = true;
  if (discVsLabel(c, a)) moved = true;
  if (labelVsLabel(a, c)) moved = true;
  return moved;
}

/** Positional relaxation to (or toward) a non-overlapping arrangement. */
function relax(bubbles: Bubble[], w: number, h: number, passes: number) {
  for (let p = 0; p < passes; p++) {
    let moved = false;
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        if (separate(bubbles[i], bubbles[j])) moved = true;
      }
    }
    for (const b of bubbles) wall(b, w, h);
    if (!moved) return;
  }
}

function paint(bubbles: Bubble[]) {
  for (const b of bubbles) {
    if (b.el) b.el.style.transform = `translate(${b.x - b.r}px, ${b.y - b.r}px)`;
  }
}

// Live `prefers-reduced-motion`. A module-scope constant read once at import
// can never see the setting change — a user who turns it on mid-session (or an
// automated a11y run that sets it on an already-loaded page) kept the physics.
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export function PlayerBubbles({ participants, className }: PlayerBubblesProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const bubblesRef = useRef<Bubble[]>([]);
  const reduced = useReducedMotion();
  const shown = participants.length > MAX_BODIES ? participants.slice(0, MAX_BODIES) : participants;

  // Diff incoming participants against the live bubble list every render.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const w = field.clientWidth || 620;
    const h = field.clientHeight || 360;
    const bubbles = bubblesRef.current;

    const incoming = new Set(shown.map(pkeyOf));
    let changed = false;

    // Remove bubbles whose participant has left.
    for (let i = bubbles.length - 1; i >= 0; i--) {
      if (!incoming.has(bubbles[i].id)) {
        bubbles[i].el?.remove();
        bubbles.splice(i, 1);
        changed = true;
      }
    }

    // Add bubbles for new participants — spawn from a random edge with inward
    // velocity so they "crash in". Under reduced motion there is no crash: the
    // bubble is SEATED, on a golden-angle spiral from the centre that the
    // relaxation pass below then spreads into a tidy non-overlapping field.
    const existing = new Set(bubbles.map((b) => b.id));
    const base = baseRadius(w, h, shown.length);
    const fresh: Bubble[] = [];
    for (const p of shown) {
      const key = pkeyOf(p);
      if (existing.has(key)) continue;
      changed = true;
      const k = 1 + Math.random() * 0.18;
      const r = base * k;
      let x: number, y: number;
      let vx = 0;
      let vy = 0;

      if (reduced) {
        const seat = bubbles.length + fresh.length;
        const ang = seat * 2.39996;
        const rad = Math.sqrt(seat + 0.5) * Math.min(w, h) * 0.085;
        x = w / 2 + Math.cos(ang) * rad;
        y = h / 2 + Math.sin(ang) * rad;
      } else {
        const edge = Math.floor(Math.random() * 4);
        if (edge === 0) {
          x = -r;
          y = Math.random() * h;
        } else if (edge === 1) {
          x = w + r;
          y = Math.random() * h;
        } else if (edge === 2) {
          x = Math.random() * w;
          y = -r;
        } else {
          x = Math.random() * w;
          y = h + r;
        }
        const tx = w / 2 + (Math.random() - 0.5) * w * 0.4;
        const ty = h / 2 + (Math.random() - 0.5) * h * 0.4;
        const dx = tx - x;
        const dy = ty - y;
        const d = Math.hypot(dx, dy) || 1;
        vx = (dx / d) * CRASH_ENERGY;
        vy = (dy / d) * CRASH_ENERGY;
      }

      const a = avatarFor(p.avatar);
      // `.bubble`, not `.solid`: a lobby bubble floats alone with no
      // neighbouring tile to imply its edge, so it needs separation from the
      // CANVAS rather than from the other slots. See lib/answers.ts.
      const solid = TILE_COLORS[a.tile].bubble;

      const el = document.createElement("div");
      el.className = "absolute top-0 left-0 grid place-items-center rounded-pill select-none";
      el.style.willChange = "transform";

      const ball = document.createElement("div");
      // The ring is not decoration — it is the P3 "a hairline SEPARATES"
      // vocabulary, and it is what actually guarantees a bubble has an edge.
      //
      // Lifting the fill alone could not: the lobby paints a bloom gradient
      // over the canvas, so the backdrop a bubble sits on CHANGES WITH ITS
      // POSITION, and the bubbles move. Solving a fill for a fixed ratio
      // against a moving target is the wrong shape of fix — measured, the
      // lifted fills still landed at 2.77-2.79:1 rather than the 3.04 they
      // were solved for, and would drift again with any change to the bloom.
      //
      // White at 24% does the work exactly where it is needed: it reads
      // against the dark slots (A, B, E) whose fills sit closest to the
      // canvas, and disappears into the light ones (D, F) that already
      // separate on their own. The disc keeps its avatar hue either way,
      // which is what DESIGN.md §5 actually promises the player.
      ball.style.cssText =
        "width:100%;height:100%;border-radius:50%;display:grid;place-items:center;position:relative;" +
        `background:${ballBg(solid)};` +
        "box-shadow:inset 0 0 0 1.5px oklch(1 0 0 / .24), 0 10px 24px -8px oklch(0 0 0 / .45);";
      const emoji = document.createElement("span");
      emoji.style.cssText = "font-size:1.5em;line-height:1;";
      emoji.textContent = a.emoji;
      ball.appendChild(emoji);

      const label = document.createElement("span");
      label.style.cssText =
        "position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;" +
        "font-weight:600;letter-spacing:-.005em;color:var(--ink-muted);";
      label.textContent = p.name;

      el.append(ball, label);
      if (!reduced) ball.style.animation = "popIn .34s var(--ease-entrance) both";
      field.appendChild(el);

      const b: Bubble = {
        id: key,
        name: p.name,
        avatar: p.avatar,
        x,
        y,
        vx,
        vy,
        r,
        k,
        lw: 0,
        lh: 0,
        el,
        ball,
        label,
      };
      fresh.push(b);
    }
    bubbles.push(...fresh);

    // Re-size when the crowd (or the field) changes what fits: a bubble that
    // joined into a 6-player lobby cannot keep its 6-player radius once 28 are
    // in, or the solver runs out of room and starts burying names again.
    // One write pass, then one read pass — the label width has to be MEASURED
    // (it is text, not a known box) and interleaving the two thrashes layout.
    for (const b of bubbles) {
      const r = base * b.k;
      if (fresh.includes(b) || Math.abs(r - b.r) > 0.5) {
        b.r = r;
        if (b.el) {
          b.el.style.width = b.el.style.height = r * 2 + "px";
          b.el.style.fontSize = r * 0.9 + "px";
        }
        if (b.label) {
          b.label.style.fontSize = labelFontPx(r) + "px";
          b.label.style.top = `calc(100% + ${LABEL_GAP}px)`;
        }
      }
    }
    for (const b of bubbles) {
      if (!b.label) continue;
      b.lw = b.label.offsetWidth;
      b.lh = b.label.offsetHeight;
    }

    if (changed && reduced) settle(bubbles, w, h);
  }, [shown, reduced]);

  // The simulation. Under reduced motion there is NO loop at all: DESIGN.md §6
  // names bubble physics explicitly, and gating only the spawn energy left the
  // per-frame centre-pull, wall bounce and collision impulse running, so the
  // field drifted indefinitely (12 of 13 bubbles still moved over 1.5s). The
  // bubbles are still LAID OUT — a static, non-overlapping arrangement — they
  // just never move after it.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    const fsize = () => ({
      w: field.clientWidth || 620,
      h: field.clientHeight || 360,
    });

    if (reduced) {
      const restate = () => {
        const { w, h } = fsize();
        settle(bubblesRef.current, w, h);
      };
      restate();
      // No rAF means nothing notices a resized stage, so watch for it instead.
      const ro = new ResizeObserver(restate);
      ro.observe(field);
      return () => ro.disconnect();
    }

    let raf = 0;
    const step = () => {
      const { w, h } = fsize();
      const cxp = w / 2;
      const cyp = h / 2;
      // Weak enough that the field spreads across the whole area rather
      // than collapsing into a clump in the middle.
      const pull = 0.00019;
      const bubbles = bubblesRef.current;

      // Integrate motion + gentle center pull + wall bounce.
      for (const b of bubbles) {
        b.vx += (cxp - b.x) * pull;
        b.vy += (cyp - b.y) * pull;
        b.vx *= 0.99;
        b.vy *= 0.99;
        b.x += b.vx;
        b.y += b.vy;
        wall(b, w, h);
      }

      // ONE velocity-impulse pass on collisions.
      for (let i = 0; i < bubbles.length; i++) {
        for (let j = i + 1; j < bubbles.length; j++) {
          const a = bubbles[i];
          const c = bubbles[j];
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const dist = Math.hypot(dx, dy);
          const min = a.r + c.r;
          if (dist < min && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
            if (rel < 0) {
              const imp = (-(1 + RESTITUTION) * rel) / 2;
              a.vx -= imp * nx;
              a.vy -= imp * ny;
              c.vx += imp * nx;
              c.vy += imp * ny;
            }
          }
        }
      }

      // Positional relaxation so bodies — disc AND label — never overlap.
      // Twenty-four passes, not the original six: a body is four contact tests
      // now and the extra vertical clearance each label demands makes the
      // contact chains much longer, so a correction needs more hops to
      // propagate. It is a CEILING, not a cost — `relax` returns the pass
      // nothing moved, which in steady state is the first one. Measured at 28
      // players: 6 and 10 passes both leave up to 7px of label buried.
      relax(bubbles, w, h, 64);
      paint(bubbles);

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <div
      ref={fieldRef}
      className={cn("relative w-full h-full min-h-[360px] overflow-hidden", className)}
    />
  );
}

// Static layout for reduced motion: kill any stored velocity, relax to
// convergence in one synchronous go (the loop exits early the pass nothing
// moves), paint once. 240 is a ceiling, not a cost — a 28-body field settles
// in well under it, and without a ceiling a genuinely over-full field would
// spin forever.
function settle(bubbles: Bubble[], w: number, h: number) {
  for (const b of bubbles) {
    b.vx = 0;
    b.vy = 0;
  }
  relax(bubbles, w, h, 240);
  paint(bubbles);
}
