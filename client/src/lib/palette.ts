// Shared color/shape palette for multiple-choice options — used by both the
// participant's answer tiles and the presenter's bar chart so a given option
// looks the same color everywhere (like Kahoot/Menti's colored answer tiles).
export const TILE_COLORS = [
  { gradient: "from-rose-500 to-pink-600", solid: "#f43f5e", shape: "▲" },
  { gradient: "from-blue-500 to-indigo-600", solid: "#3b82f6", shape: "◆" },
  { gradient: "from-amber-400 to-orange-500", solid: "#f59e0b", shape: "●" },
  { gradient: "from-emerald-400 to-teal-500", solid: "#10b981", shape: "■" },
  { gradient: "from-purple-500 to-fuchsia-600", solid: "#a855f7", shape: "★" },
  { gradient: "from-cyan-400 to-sky-500", solid: "#06b6d4", shape: "✦" },
];

export function tileFor(index: number) {
  return TILE_COLORS[index % TILE_COLORS.length];
}
