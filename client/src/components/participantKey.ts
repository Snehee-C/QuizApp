/**
 * ONE identity for a person on the wire, across both audiences.
 *
 * `participantId` is a bearer token: knowing one is the whole of what
 * `participant:join` needs to assume that person's seat and overwrite their
 * answers. It was being broadcast to every phone in the room — on
 * `participant:count`, on `leaderboard:show`, on `session:ended` — so it is
 * being removed from every participant-facing frame. Presenter sockets keep
 * it (the host is already trusted with the room); phones get `pkey` instead,
 * a stable per-session HMAC that identifies a row without unlocking it.
 *
 * Several of these components render on BOTH surfaces — `BarRaceLeaderboard`
 * is the stage's standings AND the phone's scoreboard — so they cannot key off
 * a field only one audience receives. `pkey` is sent to everyone, so it is the
 * key; `participantId` remains the fallback for presenter frames that predate
 * the change and for an older server.
 *
 * Within a session `pkey` is as stable and as unique as `participantId`, which
 * is what the bar race's remembered board and `raceKey` scoping need. ACROSS
 * sessions it deliberately differs, which only strengthens the race's
 * staleness guards: a replay of the same deck with the same phones no longer
 * even looks like the same room to the baseline.
 */
export interface RowIdentity {
  /** Sent to every audience. The key. */
  pkey?: string;
  /** Presenter frames only, from the server change on. */
  participantId?: string;
}

export function pkeyOf(row: RowIdentity): string {
  return row.pkey ?? row.participantId ?? "";
}
