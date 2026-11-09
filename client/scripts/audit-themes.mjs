// Audits every theme's accent against its own ink. The accent is the fill
// behind the reveal badge and the correct-answer check — both are stage
// CONTENT (DESIGN.md §5), so they owe 7:1, not the 4.5:1 desk-distance chrome
// owes. Also checks the accent used AS TEXT on its own canvas.
import fs from "node:fs";
const f = (t) => (t <= 0.0031308 ? 12.92 * t : 1.055 * Math.pow(t, 1 / 2.4) - 0.055);
function ok(L, C, H) {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774*a + 0.2158037573*b, m_ = L - 0.1055613458*a - 0.0638541728*b, s_ = L - 0.0894841775*a - 1.291485548*b;
  const l = l_**3, m = m_**3, s = s_**3;
  const r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s;
  const g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s;
  const bl = -0.0041960863*l - 0.7034186147*m + 1.707614701*s;
  const clipped = [r,g,bl].some(v => v < -0.002 || v > 1.002);
  const to8 = v => Math.max(0, Math.min(255, Math.round(f(Math.max(0, Math.min(1, v)))*255)));
  const [R,G,B] = [to8(r), to8(g), to8(bl)];
  const lin = v => { v/=255; return v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4; };
  return { Y: 0.2126*lin(R)+0.7152*lin(G)+0.0722*lin(B), clipped,
           hex: "#"+[R,G,B].map(v=>v.toString(16).padStart(2,"0")).join("") };
}
const parse = s => { const m = /oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(s); return m ? [ +m[1], +m[2], +m[3] ] : null; };
const ratio = (a, b) => { const [hi, lo] = a > b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); };

const src = fs.readFileSync(new URL("../src/lib/themes.ts", import.meta.url), "utf8");
const tokens = fs.readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const blocks = [...src.matchAll(/key:\s*"(\w+)"[\s\S]*?dark:\s*\{([\s\S]*?)\},\s*light:\s*\{([\s\S]*?)\},/g)];
const field = (txt, name) => { const m = new RegExp(name + ':\\s*"([^"]+)"').exec(txt); return m ? m[1] : null; };

// tokens.css carries a SECOND copy of the palette. applyTheme() writes inline
// custom properties that outrank it, so this half only reaches a projector
// before a theme is applied -- which is exactly why it can rot unnoticed. It is
// audited to the same 7:1 the themed half owes.
function cssBlock(name) {
  const i = tokens.indexOf(name);
  if (i < 0) return null;
  const open = tokens.indexOf("{", i), close = tokens.indexOf("\n}", open);
  return tokens.slice(open, close);
}
const cssVar = (block, name) => {
  const m = new RegExp("--" + name + ":\\s*(oklch\\([^)]*\\))").exec(block || "");
  return m ? m[1] : null;
};

console.log("theme/stage      accent          ink      accent:ink   accent:canvas   verdict");
const fixes = [];
for (const [, key, darkTxt, lightTxt] of blocks) {
  for (const [stage, txt] of [["dark", darkTxt], ["light", lightTxt]]) {
    const A = parse(field(txt, "accent")), I = parse(field(txt, "accentInk")), CV = parse(field(txt, "canvas"));
    if (!A || !I || !CV) continue;
    const a = ok(...A), i = ok(...I), cv = ok(...CV);
    const crInk = ratio(a.Y, i.Y), crCanvas = ratio(a.Y, cv.Y);
    const bad = crInk < 7;
    console.log(
      `${(key + "/" + stage).padEnd(17)}${a.hex}  ${i.hex}  ${crInk.toFixed(2).padStart(8)}:1  ${crCanvas.toFixed(2).padStart(8)}:1   ${bad ? "FAIL (<7:1)" : "ok"}`
    );
    if (bad) {
      // keep the hue; find the nearest lightness that clears 7:1 against this
      // ink, carrying the greatest in-gamut chroma at that step.
      const H = A[2], darkInk = i.Y < a.Y;
      let best = null;
      const step = darkInk ? +0.005 : -0.005;     // dark ink -> lighten; light ink -> darken
      for (let L = A[0]; L > 0.2 && L < 0.98; L += step) {
        let C = 0;
        for (let c = 0.3; c >= 0.02; c -= 0.002) if (!ok(L, c, H).clipped) { C = c; break; }
        const col = ok(L, C, H);
        if (ratio(col.Y, i.Y) >= 7) { best = { L: +L.toFixed(3), C: +C.toFixed(3), hex: col.hex, cr: +ratio(col.Y, i.Y).toFixed(2), crCanvas: +ratio(col.Y, cv.Y).toFixed(2) }; break; }
      }
      fixes.push({ key, stage, from: field(txt, "accent"), best });
    }
  }
}
// --- tokens.css fallback palette (the un-themed half) ---
for (const [label, sel] of [["tokens/:root", ":root {"], ["tokens/light", '[data-stage="light"]']]) {
  const block = cssBlock(sel);
  const A = parse(cssVar(block, "accent") || ""), I = parse(cssVar(block, "accent-ink") || ""), CV = parse(cssVar(block, "canvas") || "");
  if (!A || !I || !CV) { console.log(`${label.padEnd(17)}(not declared here — inherits :root)`); continue; }
  const a = ok(...A), i = ok(...I), cv = ok(...CV);
  const crInk = ratio(a.Y, i.Y), crCanvas = ratio(a.Y, cv.Y), bad = crInk < 7;
  console.log(`${label.padEnd(17)}${a.hex}  ${i.hex}  ${crInk.toFixed(2).padStart(8)}:1  ${crCanvas.toFixed(2).padStart(8)}:1   ${bad ? "FAIL (<7:1)" : "ok"}`);
  if (bad) fixes.push({ key: label, stage: "-", from: cssVar(block, "accent"), best: { L: "?", C: "?", cr: crInk.toFixed(2), crCanvas: crCanvas.toFixed(2) } });
}

if (fixes.length === 0) {
  console.log(`\ntheme audit: clean — ${blocks.length * 2 + 2} accent pairs (themes.ts + tokens.css fallback), all >=7:1 against their own ink`);
  process.exit(0);
}
console.error("\nFAIL — these accents do not clear the 7:1 the stage owes (DESIGN.md §5):");
for (const fx of fixes) {
  console.error(` ${fx.key}/${fx.stage}: ${fx.from} -> oklch(${fx.best.L} ${fx.best.C} ${parse(fx.from)[2]})  = ${fx.best.cr}:1 ink, ${fx.best.crCanvas}:1 canvas`);
}
process.exit(1);
