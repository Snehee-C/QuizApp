#!/usr/bin/env node
// Design-system lint (DESIGN.md P1/P5).
//
// Three things the system cannot police by code review, because every one of
// them is invisible in a diff and only shows up as a vague "something's off":
//
//   1. an arbitrary type size, which is how we acquired twenty-one of them
//   2. a stock Tailwind size, which is a second spelling of a ladder step
//   3. a font-size registered in tailwind.config.js but NOT in lib/cn.ts,
//      which makes tailwind-merge silently discard it at runtime
//
// Exit 1 on any finding.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?)$/.test(p)) out.push(p);
  }
  return out;
}

const STOCK = /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/g;
// `text-[0.6em]` is relative sizing — a different mechanism, and one a ladder
// cannot express. Absolute values are the defect.
const ARBITRARY = /text-\[(?!var\()([^\]]*\d[^\]]*)\]/g;

const findings = [];

for (const file of walk(SRC)) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(STOCK)) {
      findings.push([relative(ROOT, file), i + 1, m[0], "stock Tailwind size — use a ladder role"]);
    }
    for (const m of line.matchAll(ARBITRARY)) {
      if (/[\d.]em\]$/.test(m[0])) continue; // relative glyph sizing
      findings.push([relative(ROOT, file), i + 1, m[0], "arbitrary type size — use a ladder role"]);
    }
  });
}

// The cn.ts invariant.
const cfg = await import(pathToFileURL(join(ROOT, "tailwind.config.js")).href);
const steps = Object.keys(cfg.default.theme.extend.fontSize);
const cn = readFileSync(join(SRC, "lib/cn.ts"), "utf8");
for (const step of steps) {
  if (!cn.includes(`"${step}"`)) {
    findings.push(["src/lib/cn.ts", 0, step, "font size not registered — tailwind-merge will drop it"]);
  }
}

if (findings.length === 0) {
  console.log(`design lint: clean — ${steps.length} type steps, all registered with tailwind-merge`);
  process.exit(0);
}
for (const [f, l, what, why] of findings) console.error(`${f}:${l}  ${what}  — ${why}`);
console.error(`\ndesign lint: ${findings.length} finding(s). See DESIGN.md P1/P5.`);
process.exit(1);
