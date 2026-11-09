// Preset participant avatars. Each avatar carries an emoji plus a `tile` index
// into TILE_COLORS (palette.ts) that decides its color everywhere it appears
// (lobby bubbles, leaderboard bars, podium). The avatar is represented on the
// wire as a plain NUMBER (an index into AVATARS); components resolve it back to
// an Avatar via `avatarFor(index)`.
export interface Avatar {
  emoji: string;
  tile: number; // index into TILE_COLORS (palette.ts) for its color
}

export const AVATARS: Avatar[] = [
  { emoji: "🚀", tile: 0 },
  { emoji: "🦊", tile: 1 },
  { emoji: "🐼", tile: 2 },
  { emoji: "🐸", tile: 3 },
  { emoji: "🦄", tile: 4 },
  { emoji: "🐙", tile: 5 },
  { emoji: "🐯", tile: 0 },
  { emoji: "🐧", tile: 1 },
  { emoji: "🐨", tile: 4 },
  { emoji: "🦁", tile: 2 },
  { emoji: "🐵", tile: 0 },
  { emoji: "🐷", tile: 3 },
  { emoji: "🐔", tile: 3 },
  { emoji: "🦉", tile: 1 },
  { emoji: "🐝", tile: 2 },
  { emoji: "🐢", tile: 5 },
];

// Deterministic string hash → 0..AVATARS.length-1, stable per participantId so a
// given player always gets the same avatar across renders and reloads.
export function avatarIndexFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return ((hash % AVATARS.length) + AVATARS.length) % AVATARS.length;
}

// Resolve an avatar index (possibly negative or out of range) to a preset.
export function avatarFor(index: number): Avatar {
  const len = AVATARS.length;
  return AVATARS[((index % len) + len) % len];
}
