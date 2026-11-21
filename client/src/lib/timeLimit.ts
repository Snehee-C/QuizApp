// The one legal range for a slide's `timeLimitSec`.
//
// MIRRORS server/src/slides/types.ts (MIN_TIME_LIMIT_SEC / MAX_TIME_LIMIT_SEC /
// clampTimeLimitSec). The server clamps at runtime whatever the editor stored,
// silently, which is how a cleared field persisted `0` and ran as 5 seconds in
// front of a room without the author ever being told (UX-PLAN 5.2). The editor
// now clamps to the same bounds BEFORE it saves, and shows the clamped value,
// so what is stored is what runs. If the server's bounds move, these move.

export const MIN_TIME_LIMIT_SEC = 5;
export const MAX_TIME_LIMIT_SEC = 600;
export const DEFAULT_TIME_LIMIT_SEC = 20;

/**
 * Numbers and numeric strings clamp; a cleared field is `Number("") === 0`
 * and lands on the minimum, exactly as the server treated the `0` the old
 * field used to send — now visibly, before the save. Anything that is not a
 * number at all (`undefined`, "abc") is the default, as on the server.
 */
export function clampTimeLimitSec(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : Number.NaN;
  const safe = Number.isFinite(n) ? n : DEFAULT_TIME_LIMIT_SEC;
  return Math.min(MAX_TIME_LIMIT_SEC, Math.max(MIN_TIME_LIMIT_SEC, Math.round(safe)));
}
