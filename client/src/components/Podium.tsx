export interface LeaderboardEntry {
  participantId: string;
  name: string;
  score: number;
}

export function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const [first, second, third] = entries;
  const medal = ["🥇", "🥈", "🥉"];
  const order = [second, first, third].filter(Boolean) as LeaderboardEntry[];
  return (
    <div className="flex items-end gap-3 justify-center">
      {order.map((e) => {
        const isFirst = e === first;
        return (
          <div key={e.participantId} className="flex flex-col items-center gap-1">
            <span className="text-2xl">{medal[entries.indexOf(e)]}</span>
            <div
              className={`w-24 rounded-t-xl flex items-end justify-center pb-2 shadow-md ${
                isFirst
                  ? "h-32 bg-gradient-to-b from-amber-300 to-amber-500"
                  : e === second
                    ? "h-24 bg-gradient-to-b from-slate-300 to-slate-400"
                    : "h-20 bg-gradient-to-b from-orange-300 to-orange-500"
              }`}
            >
              <span className="text-white text-sm font-bold truncate px-2 drop-shadow">{e.name}</span>
            </div>
            <span className="text-gray-500 text-sm font-semibold">{e.score}pts</span>
          </div>
        );
      })}
    </div>
  );
}

export function LeaderboardList({ entries }: { entries: LeaderboardEntry[] }) {
  const medal = ["🥇", "🥈", "🥉"];
  return (
    <div className="flex flex-col gap-2 w-full max-w-md">
      {entries.map((e, i) => (
        <div
          key={e.participantId}
          className="flex items-center justify-between bg-white border border-gray-200 shadow-sm rounded-xl px-4 py-3 animate-slide-up"
          style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-lg font-black w-8 text-center">{medal[i] ?? `#${i + 1}`}</span>
            <span className="font-semibold text-gray-800">{e.name}</span>
          </div>
          <span className="font-bold text-brand">{e.score} pts</span>
        </div>
      ))}
      {entries.length === 0 && <p className="text-gray-400 text-center">No scores yet</p>}
    </div>
  );
}
