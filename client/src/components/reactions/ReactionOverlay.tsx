import { useEffect, useRef, useState } from "react";
import { getSocket } from "../../lib/socket";
import { prefersReducedMotion } from "../../lib/motion";

/**
 * The wire contract, mirrored from `server/src/sockets/qa.ts`. The server
 * silently drops any `kind` outside this set, so the two lists must stay
 * identical. They live in this module rather than a shared one because the
 * brief allows exactly two new files — and because this module carries no UI
 * dependencies, so the phone strip can import from it without dragging the
 * stage canvas along.
 */
export const REACTION_KINDS = ["heart", "fire", "clap", "laugh", "wow", "think"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/**
 * Emoji here are *content*, not interface icons (DESIGN.md §7) — they are the
 * thing the audience chose to say, the same way an avatar is.
 */
export const REACTION_GLYPH: Record<ReactionKind, string> = {
  heart: "❤️",
  fire: "🔥",
  clap: "👏",
  laugh: "😂",
  wow: "😮",
  think: "🤔",
};

export const REACTION_LABEL: Record<ReactionKind, string> = {
  heart: "Love it",
  fire: "Fire",
  clap: "Applause",
  laugh: "Funny",
  wow: "Wow",
  think: "Thinking",
};

export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === "string" && (REACTION_KINDS as readonly string[]).includes(value);
}

/**
 * A room of 200 people at the server's 5/sec ceiling can land ~1000 bursts a
 * second. Past this many glyphs nothing new is legible anyway, so excess is
 * dropped on arrival rather than queued — a queue would turn a 10-second flood
 * into a minute of catch-up animation on the projector.
 */
const MAX_PARTICLES = 60;

/** <canvas> has no emoji fallback of its own; name the platform faces. */
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

interface Particle {
  glyph: string;
  /** Centre of the wobble, not the drawn position. */
  x: number;
  y: number;
  /** px per second, upward. */
  vy: number;
  size: number;
  amp: number;
  wobble: number;
  phase: number;
  age: number;
  ttl: number;
}

interface ReactionOverlayProps {
  joinCode: string;
}

export function ReactionOverlay({ joinCode }: ReactionOverlayProps) {
  // Read once per mount: the branch picks a different component tree, and
  // swapping trees mid-session on an OS setting change is not worth the churn.
  const [reduced] = useState(prefersReducedMotion);
  return reduced ? <ReactionTally joinCode={joinCode} /> : <ReactionCanvas joinCode={joinCode} />;
}

/**
 * One <canvas> and one rAF loop, following `lib/confetti.ts`. N animated DOM
 * nodes would mean N layers and N style recalcs per frame; at 60 concurrent
 * particles on a projector-driving laptop that is the difference between a
 * smooth float and a stuttering one.
 */
function ReactionCanvas({ joinCode }: ReactionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: Particle[] = [];
    let raf: number | null = null;
    let last = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // setTransform resets nothing else, but a resized backing store does drop
      // these, so re-assert them here rather than per draw call.
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = (now: number) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Time-based, not frame-based: a projector that drops to 30fps should
      // show slower frames, not slower reactions. Clamped so a backgrounded
      // tab (rAF pauses) doesn't teleport every particle off-screen on wake.
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;

      ctx.clearRect(0, 0, w, h);
      particles = particles.filter((p) => (p.age += dt) < p.ttl);

      for (const p of particles) {
        const t = p.age / p.ttl;
        p.y -= p.vy * dt;
        // Fade in fast so a glyph never pops into existence at full opacity,
        // then spend the last third of the life fading out.
        ctx.globalAlpha = t < 0.08 ? t / 0.08 : Math.min(1, (1 - t) / 0.34);
        ctx.font = `${p.size}px ${EMOJI_FONT}`;
        ctx.fillText(p.glyph, p.x + Math.sin(p.phase + p.age * p.wobble) * p.amp, p.y);
      }
      ctx.globalAlpha = 1;

      if (particles.length > 0) {
        raf = requestAnimationFrame(tick);
      } else {
        // Idle rooms cost nothing: the loop stops entirely between bursts.
        raf = null;
        last = 0;
      }
    };

    const onBurst = (payload: { kind?: unknown }) => {
      const kind = payload?.kind;
      if (!isReactionKind(kind)) return;
      if (particles.length >= MAX_PARTICLES) return;

      const w = window.innerWidth;
      const h = window.innerHeight;
      const size = Math.round(Math.min(76, Math.max(34, w * 0.032)));
      // Varied travel time is what stops a synchronised flood from reading as
      // one rigid marching column.
      const ttl = 3.8 + Math.random() * 2.4;

      particles.push({
        glyph: REACTION_GLYPH[kind],
        // Keep clear of the stage safe area, where the question lives.
        x: w * (0.06 + Math.random() * 0.88),
        y: h + size,
        vy: (h + size * 2) / ttl,
        size,
        amp: 10 + Math.random() * 26,
        wobble: 0.9 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
        age: 0,
        ttl,
      });

      if (raf === null) raf = requestAnimationFrame(tick);
    };

    const socket = getSocket();
    socket.on("reaction:burst", onBurst);

    return () => {
      // Same handler reference — a bare off("reaction:burst") would also
      // unsubscribe whatever else the page has listening.
      socket.off("reaction:burst", onBurst);
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
    // joinCode only re-runs the subscription when the stage moves to another
    // session; the burst payload itself carries no room id (the server scopes
    // the broadcast to the room this socket is already in).
  }, [joinCode]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      // z-20: above stage content, below the presenter control bar (z-30).
      className="fixed inset-0 z-20 h-full w-full pointer-events-none"
    />
  );
}

/** Flush window for coalescing bursts into a single React render. */
const FLUSH_MS = 250;
/** How long a tally lingers after the room goes quiet. */
const IDLE_MS = 2600;

/**
 * The reduced-motion stage: nothing moves. The room's reactions still reach the
 * presenter, as a static tally that appears, updates and clears — no float, no
 * drift, no fade loop (DESIGN.md §6).
 */
function ReactionTally({ joinCode }: ReactionOverlayProps) {
  const [counts, setCounts] = useState<Partial<Record<ReactionKind, number>>>({});
  const pending = useRef<Partial<Record<ReactionKind, number>>>({});
  const flushTimer = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    const socket = getSocket();

    const onBurst = (payload: { kind?: unknown }) => {
      const kind = payload?.kind;
      if (!isReactionKind(kind)) return;
      pending.current[kind] = (pending.current[kind] ?? 0) + 1;

      // A thousand bursts a second must not be a thousand renders a second.
      if (flushTimer.current === null) {
        flushTimer.current = window.setTimeout(() => {
          flushTimer.current = null;
          setCounts({ ...pending.current });
        }, FLUSH_MS);
      }
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        pending.current = {};
        setCounts({});
      }, IDLE_MS);
    };

    socket.on("reaction:burst", onBurst);
    return () => {
      socket.off("reaction:burst", onBurst);
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, [joinCode]);

  const shown = REACTION_KINDS.filter((k) => (counts[k] ?? 0) > 0);
  if (shown.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-x-0 bottom-0 z-20 flex justify-center pointer-events-none pb-[var(--s-9)]"
    >
      <div className="flex items-center gap-[var(--s-4)] rounded-pill bg-surface-2 px-[var(--s-5)] py-[var(--s-3)] shadow-elev-1">
        {shown.map((kind) => (
          <span key={kind} className="flex items-center gap-[var(--s-2)] text-ink">
            <span className="text-title1 leading-none">{REACTION_GLYPH[kind]}</span>
            <span className="nums text-stage-label text-ink-muted">{counts[kind]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default ReactionOverlay;
