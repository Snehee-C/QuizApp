/** @type {import('tailwindcss').Config} */
// Tailwind is mapped onto the FLOODLIGHT CSS custom properties (see
// client/src/styles/tokens.css + DESIGN.md) rather than carrying its own
// palette. One consequence: a theme swap (Stage Dark <-> Stage Light) is a
// data-attribute change on <html>, with no class rewriting anywhere.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        hairline: { DEFAULT: "var(--hairline)", strong: "var(--hairline-str)" },
        ink: {
          DEFAULT: "var(--ink)",
          muted: "var(--ink-muted)",
          subtle: "var(--ink-subtle)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          dim: "var(--accent-dim)",
          ink: "var(--accent-ink)",
        },
        correct: "var(--correct)",
        incorrect: "var(--incorrect)",
        warn: "var(--warn)",
        streak: "var(--streak)",
        danger: "var(--danger)",
      },
      fontFamily: {
        // One family (DESIGN.md P1). `display` is kept as an alias rather than
        // a second typeface so call sites can still say "this is display type"
        // without that meaning "load another font".
        display: "var(--font-display)",
        ui: "var(--font-ui)",
        mono: "var(--font-mono)",
      },
      borderRadius: {
        xs: "var(--r-xs)",
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)",
        "2xl": "var(--r-2xl)",
        pill: "var(--r-pill)",
      },
      boxShadow: {
        line: "var(--line)",
        "elev-1": "var(--elev-1)",
        "elev-2": "var(--elev-2)",
        "elev-3": "var(--elev-3)",
        glow: "var(--glow)",
        focus: "var(--focus)",
      },
      spacing: {
        "stage-safe": "var(--stage-safe)",
        "stage-gap": "var(--stage-gap)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        entrance: "var(--ease-entrance)",
        exit: "var(--ease-exit)",
        "expo-out": "var(--ease-expo-out)",
        "back-out": "var(--ease-back-out)",
      },
      transitionDuration: {
        instant: "80ms",
        fast: "140ms",
        base: "220ms",
        slow: "320ms",
        stage: "520ms",
      },
      fontSize: {
        // ── The UI ladder (DESIGN.md §4). Eleven steps, named by ROLE, with
        // line-height and tracking baked into each one. Call sites choose a
        // role, never a pixel value — that is how a system avoids silently
        // acquiring twenty-one type sizes.
        //
        // Tracking tightens as size grows (optical compensation). The one
        // place it goes positive is uppercase label text, via `.track-label`.
        //
        // NOTE: every name here must also be registered in lib/cn.ts, or
        // tailwind-merge cannot tell `text-body` from `text-ink` and will
        // silently discard the size. That has bitten us once already.
        caption2: ["11px", { lineHeight: "1.35", letterSpacing: "0.01em" }],
        caption: ["12px", { lineHeight: "1.35", letterSpacing: "0.005em" }],
        footnote: ["13px", { lineHeight: "1.4", letterSpacing: "0em" }],
        subhead: ["15px", { lineHeight: "1.45", letterSpacing: "-0.005em" }],
        callout: ["16px", { lineHeight: "1.45", letterSpacing: "-0.01em" }],
        body: ["17px", { lineHeight: "1.5", letterSpacing: "-0.011em" }],
        title3: ["20px", { lineHeight: "1.3", letterSpacing: "-0.015em" }],
        title2: ["22px", { lineHeight: "1.25", letterSpacing: "-0.018em" }],
        title1: ["28px", { lineHeight: "1.2", letterSpacing: "-0.022em" }],
        "large-title": ["34px", { lineHeight: "1.15", letterSpacing: "-0.028em" }],
        display: ["40px", { lineHeight: "1.1", letterSpacing: "-0.032em" }],

        // The marketing landing page is the one surface read at desk distance
        // that still wants to scale with the window. Two named fluid steps,
        // rather than a clamp() typed into a component (DESIGN.md P5).
        hero: ["clamp(38px, 5.6vw, 76px)", { lineHeight: "1.0", letterSpacing: "-0.032em" }],
        "hero-sub": ["clamp(16px, 2vw, 21px)", { lineHeight: "1.55", letterSpacing: "-0.011em" }],

        // ── The stage ladder. Deliberately NOT the UI ladder scaled up: the
        // stage is read at six metres, so it is viewport-anchored (designed at
        // 1920x1080) and floored at 24px (DESIGN.md §5).
        //
        // THE ANCHOR IS `min(Xvw, Yvh)`, AND IT HAS NO CEILING.
        //
        // Every step here used to be `clamp(floor, Xvw, cap)`, and the caps all
        // landed within 80px of each other: stage-q stopped at 2000px wide,
        // stage-answer at 2077, stage-label at 2074. Past roughly 2080x1555 CSS
        // px the whole stage stopped scaling at once. Measured on a 4K
        // projector at its native mode (3840x2160, deviceScaleFactor 1), which
        // is exactly the deployment this product is for: question 104px =
        // 4.81vh against 1080p's 9.63vh, answer label 54px = 2.50vh against
        // 4.62vh, the answer block 19% of the screen against 42%. Nothing
        // clipped, nothing scrolled — the room's screen was simply drawn at a
        // little over half size, in a band through the middle, with ~30% of the
        // projection empty above and below. A person fifteen feet back reads an
        // ANGULAR size, which is the fraction of the screen a glyph occupies,
        // so a cap on that fraction is a cap on legibility.
        //
        // The caps existed for one real reason: `vw` alone on a 32:9 display
        // puts a 230px headline on a 1440px-tall stage. `min(Xvw, Yvh)` answers
        // that directly — type follows whichever dimension is scarcer — so the
        // ceiling has nothing left to do and is gone. Above the floor, the
        // stage now occupies the same fraction of the screen at every size.
        //
        // The two numbers are ONE number: Yvh is Xvw converted at the design
        // aspect, X * 16/9. On any 16:9 viewport the two sides of the `min()`
        // are equal to the last decimal, so 1920x1080 — and every other 16:9
        // size eight rounds of QA measured — renders byte-identically to the
        // old `clamp()`. Only non-16:9 and post-cap sizes move.
        "stage-code": ["max(64px, min(11vw, 19.5556vh))", { lineHeight: "0.9" }],
        "stage-q": ["max(40px, min(5.2vw, 9.2444vh))", { lineHeight: "1.06", letterSpacing: "-0.028em" }],
        "stage-q-sm": ["max(34px, min(4.2vw, 7.4667vh))", { lineHeight: "1.08", letterSpacing: "-0.026em" }],
        "stage-answer": ["max(26px, min(2.6vw, 4.6222vh))", { lineHeight: "1.15", letterSpacing: "-0.018em" }],
        "stage-name": ["max(22px, min(2vw, 3.5556vh))", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        "stage-label": ["max(18px, min(1.35vw, 2.4vh))", { lineHeight: "1.3", letterSpacing: "-0.005em" }],
      },
      keyframes: {
        popIn: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        riseIn: {
          "0%": { transform: "translateY(14px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        shimmer: { to: { backgroundPosition: "200% 0" } },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        tick: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.06)" },
        },
        breathe: {
          "0%, 100%": { boxShadow: "0 0 0 2px var(--accent-a45), 0 0 28px var(--accent-a18)" },
          "50%": { boxShadow: "0 0 0 2px var(--accent-a45), 0 0 52px var(--accent-a45)" },
        },
      },
      animation: {
        "pop-in": "popIn 0.42s var(--ease-back-out) both",
        "rise-in": "riseIn 0.34s var(--ease-entrance) both",
        shimmer: "shimmer 4s linear infinite",
        float: "float 4s ease-in-out infinite",
        tick: "tick 1s var(--ease-standard) infinite",
        breathe: "breathe 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
