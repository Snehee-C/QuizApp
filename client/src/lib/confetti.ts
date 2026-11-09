// Imperative canvas confetti — self-contained, no dependencies beyond the DOM.
// A single fixed full-screen <canvas> is lazily created on first burst and a
// requestAnimationFrame loop draws falling particles with gravity, rotation and
// fade. No-op when the user prefers reduced motion.
import { TILE_COLORS } from "./palette";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  rot: number;
  vr: number;
  s: number;
  color: string;
}

// The accent plus the answer palette. Resolved hex, not custom properties —
// <canvas> cannot read CSS variables.
const COLORS = [
  "#a1ee54", // accent lime
  ...TILE_COLORS.map((t) => t.solid),
  "#ffffff",
];

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let rafId: number | null = null;
let dpr = 1;

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function sizeCanvas() {
  if (!canvas || !ctx) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "60";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);
}

function tick() {
  if (!ctx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.vy += p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 0.012;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
    ctx.restore();
  }
  if (particles.length > 0) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}

function spawn(x: number, y: number, count: number) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = Math.random() * 8 + 3;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 4,
      g: 0.22,
      life: 1,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4,
      s: Math.random() * 6 + 4,
      color: COLORS[i % COLORS.length],
    });
  }
  if (rafId === null) {
    rafId = requestAnimationFrame(tick);
  }
}

export function burstAt(x: number, y: number, count = 90) {
  if (prefersReducedMotion()) return;
  ensureCanvas();
  spawn(x, y, count);
}

export function burstFrom(el: Element | null, count = 90) {
  if (!el || prefersReducedMotion()) return;
  const r = el.getBoundingClientRect();
  burstAt(r.left + r.width / 2, r.top + r.height / 2, count);
}
