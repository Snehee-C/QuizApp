import { useEffect, useState } from "react";

/**
 * The stage's viewport anchor, as a NUMBER.
 *
 * The type ladder expresses it in CSS — every stage step is
 * `max(floor, min(Xvw, Yvh))` with the two coefficients converted at the
 * design aspect (tailwind.config.js). Two things on the stage cannot be
 * written that way and so used to be the only parts of it that did not scale:
 *
 *   - `FitText`, which binary-searches a px size and needs a px ceiling
 *   - `TimerRing` / the lobby QR, whose sizes are px props carried into SVG
 *     geometry
 *
 * Both now read a px number that means "px at the design size", scaled by the
 * same anchor the ladder uses: the SMALLER of the two viewport ratios. Scaling
 * off the width alone is what the old `clamp()` ceilings were really guarding
 * against — a 32:9 display has width to burn and height it does not — and the
 * min() says that directly instead.
 *
 * Exactly 1.0 at 1920x1080, so every number measured there is unchanged.
 * DESIGN.md §5.
 */
export const STAGE_W = 1920;
export const STAGE_H = 1080;

export function stageScale(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
}

/** `stageScale()` as React state, kept current across a resize. */
export function useStageScale(): number {
  const [k, setK] = useState(stageScale);
  useEffect(() => {
    const on = () => setK(stageScale());
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return k;
}
