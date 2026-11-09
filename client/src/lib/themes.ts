// Stage themes.
//
// A theme is a small set of token OVERRIDES layered on top of FLOODLIGHT
// (styles/tokens.css) — not a separate palette. Only the canvas family and the
// NOTE ON THE LIGHT ACCENTS: all four are SOLVED, not picked. The accent is
// the fill behind the reveal badge and the correct-answer check, and both are
// stage CONTENT read from the back of a lit room -- so they owe the DESIGN.md
// §5 target of 7:1 against their own ink, not the 4.5:1 desk-distance chrome
// owes. Every light accent here was originally eyeballed near L 0.50 and every
// one measured 5.15-5.72:1. An automated audit caught that, not a reviewer,
// which is why `npm run audit:themes` now guards them. Each was re-solved to
// the lightest step clearing 7:1, carrying the greatest in-gamut chroma at
// that step so it stays saturated rather than going muddy to buy contrast.
//
// accent move; the answer-slot ladder never moves PER THEME, because those
// colours are
//
// PRECISION, because an agent caught this comment disagreeing with the pixels:
// the ladder is independent of the THEME axis (floodlight/ember/tide/paper)
// but NOT of the STAGE axis. tokens.css deliberately steps slots C, D and F
// down one notch under [data-stage="light"] -- on paper the two light slots
// lose their edge against the canvas. Measured consequence: slot C is 6.97:1
// on Stage Dark and 6.46:1 on Stage Light, slot D 9.95 vs 7.98. Both sit
// inside the documented §6 dead-zone exception, so nothing fails; the claim
// was simply wider than the truth.
//
// solved against contrast and CVD constraints (DESIGN.md §5) and re-tinting
// them per theme would quietly break that guarantee.
//
// Each theme supplies both stage moods, so "Bright room" keeps working.

export interface ThemeTokens {
  canvas: string;
  surface1: string;
  surface2: string;
  surface3: string;
  hairline: string;
  hairlineStrong: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  accent: string;
  accentDim: string;
  accentInk: string;
}

export interface Theme {
  key: string;
  label: string;
  /** A swatch for the picker: [canvas, accent]. */
  swatch: [string, string];
  dark: ThemeTokens;
  light: ThemeTokens;
}

export const THEMES: Theme[] = [
  {
    key: "floodlight",
    label: "Floodlight",
    swatch: ["oklch(0.15 0.012 272)", "oklch(0.87 0.2 132)"],
    dark: {
      canvas: "oklch(0.15 0.012 272)",
      surface1: "oklch(0.2 0.014 272)",
      surface2: "oklch(0.25 0.016 272)",
      surface3: "oklch(0.3 0.018 272)",
      hairline: "oklch(0.33 0.016 272)",
      hairlineStrong: "oklch(0.42 0.018 272)",
      ink: "oklch(0.97 0.004 272)",
      inkMuted: "oklch(0.78 0.012 272)",
      inkSubtle: "oklch(0.62 0.014 272)",
      accent: "oklch(0.87 0.2 132)",
      accentDim: "oklch(0.72 0.17 132)",
      accentInk: "oklch(0.2 0.05 132)",
    },
    light: {
      canvas: "oklch(0.99 0.004 95)",
      surface1: "oklch(0.97 0.006 95)",
      surface2: "oklch(0.94 0.008 95)",
      surface3: "oklch(0.91 0.009 95)",
      hairline: "oklch(0.89 0.008 95)",
      hairlineStrong: "oklch(0.8 0.01 95)",
      ink: "oklch(0.22 0.012 272)",
      inkMuted: "oklch(0.42 0.012 272)",
      inkSubtle: "oklch(0.56 0.012 272)",
      accent: "oklch(0.445 0.126 132)",
      accentDim: "oklch(0.4 0.114 132)",
      accentInk: "oklch(0.99 0.004 95)",
    },
  },
  {
    key: "ember",
    label: "Ember",
    swatch: ["oklch(0.16 0.016 40)", "oklch(0.78 0.17 48)"],
    dark: {
      canvas: "oklch(0.16 0.016 40)",
      surface1: "oklch(0.21 0.018 40)",
      surface2: "oklch(0.26 0.02 40)",
      surface3: "oklch(0.31 0.022 40)",
      hairline: "oklch(0.34 0.02 40)",
      hairlineStrong: "oklch(0.43 0.022 40)",
      ink: "oklch(0.97 0.006 70)",
      inkMuted: "oklch(0.78 0.014 50)",
      inkSubtle: "oklch(0.62 0.016 50)",
      accent: "oklch(0.78 0.17 48)",
      accentDim: "oklch(0.65 0.15 48)",
      accentInk: "oklch(0.18 0.04 48)",
    },
    light: {
      canvas: "oklch(0.99 0.006 75)",
      surface1: "oklch(0.97 0.008 75)",
      surface2: "oklch(0.94 0.01 75)",
      surface3: "oklch(0.91 0.012 75)",
      hairline: "oklch(0.89 0.01 75)",
      hairlineStrong: "oklch(0.8 0.012 75)",
      ink: "oklch(0.23 0.016 40)",
      inkMuted: "oklch(0.43 0.016 40)",
      inkSubtle: "oklch(0.57 0.016 40)",
      accent: "oklch(0.47 0.138 45)",
      accentDim: "oklch(0.42 0.124 45)",
      accentInk: "oklch(0.99 0.006 75)",
    },
  },
  {
    key: "tide",
    label: "Tide",
    swatch: ["oklch(0.15 0.022 240)", "oklch(0.8 0.14 210)"],
    dark: {
      canvas: "oklch(0.15 0.022 240)",
      surface1: "oklch(0.2 0.026 240)",
      surface2: "oklch(0.25 0.03 240)",
      surface3: "oklch(0.3 0.032 240)",
      hairline: "oklch(0.33 0.028 240)",
      hairlineStrong: "oklch(0.42 0.03 240)",
      ink: "oklch(0.97 0.006 230)",
      inkMuted: "oklch(0.78 0.016 230)",
      inkSubtle: "oklch(0.62 0.018 230)",
      accent: "oklch(0.8 0.14 210)",
      accentDim: "oklch(0.67 0.12 210)",
      accentInk: "oklch(0.17 0.04 230)",
    },
    light: {
      canvas: "oklch(0.99 0.004 230)",
      surface1: "oklch(0.97 0.006 230)",
      surface2: "oklch(0.94 0.008 230)",
      surface3: "oklch(0.91 0.01 230)",
      hairline: "oklch(0.89 0.008 230)",
      hairlineStrong: "oklch(0.8 0.01 230)",
      ink: "oklch(0.22 0.022 240)",
      inkMuted: "oklch(0.42 0.02 240)",
      inkSubtle: "oklch(0.56 0.018 240)",
      accent: "oklch(0.445 0.086 225)",
      accentDim: "oklch(0.4 0.078 225)",
      accentInk: "oklch(0.99 0.004 230)",
    },
  },
  {
    key: "paper",
    label: "Paper",
    swatch: ["oklch(0.21 0.008 90)", "oklch(0.84 0.11 85)"],
    dark: {
      canvas: "oklch(0.21 0.008 90)",
      surface1: "oklch(0.26 0.01 90)",
      surface2: "oklch(0.31 0.011 90)",
      surface3: "oklch(0.36 0.012 90)",
      hairline: "oklch(0.38 0.011 90)",
      hairlineStrong: "oklch(0.47 0.012 90)",
      ink: "oklch(0.97 0.008 90)",
      inkMuted: "oklch(0.79 0.01 90)",
      inkSubtle: "oklch(0.64 0.01 90)",
      accent: "oklch(0.84 0.11 85)",
      accentDim: "oklch(0.7 0.1 85)",
      accentInk: "oklch(0.2 0.03 85)",
    },
    light: {
      canvas: "oklch(0.98 0.008 90)",
      surface1: "oklch(0.96 0.01 90)",
      surface2: "oklch(0.93 0.012 90)",
      surface3: "oklch(0.9 0.013 90)",
      hairline: "oklch(0.88 0.012 90)",
      hairlineStrong: "oklch(0.79 0.014 90)",
      ink: "oklch(0.24 0.012 90)",
      inkMuted: "oklch(0.44 0.012 90)",
      inkSubtle: "oklch(0.58 0.012 90)",
      accent: "oklch(0.45 0.096 80)",
      accentDim: "oklch(0.4 0.086 80)",
      accentInk: "oklch(0.98 0.008 90)",
    },
  },
];

export function themeByKey(key: string | undefined): Theme {
  return THEMES.find((t) => t.key === key) ?? THEMES[0];
}

/**
 * Write a theme's overrides onto an element as inline custom properties.
 * Scoped to an element (not :root) so the presenter view can be themed while
 * the rest of the app — and any participant view in the same browser — is not.
 */
export function applyTheme(el: HTMLElement | null, key: string | undefined, mood: "dark" | "light") {
  if (!el) return;
  const t = themeByKey(key)[mood];
  const set = (name: string, value: string) => el.style.setProperty(name, value);
  set("--canvas", t.canvas);
  set("--surface-1", t.surface1);
  set("--surface-2", t.surface2);
  set("--surface-3", t.surface3);
  set("--hairline", t.hairline);
  set("--hairline-str", t.hairlineStrong);
  set("--ink", t.ink);
  set("--ink-muted", t.inkMuted);
  set("--ink-subtle", t.inkSubtle);
  set("--accent", t.accent);
  set("--accent-dim", t.accentDim);
  set("--accent-ink", t.accentInk);
  // Derived alphas must track the accent or the focus ring and glow keep the
  // old hue.
  set("--accent-a45", `color-mix(in oklch, ${t.accent} 45%, transparent)`);
  set("--accent-a18", `color-mix(in oklch, ${t.accent} 18%, transparent)`);
}
