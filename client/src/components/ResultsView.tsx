import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { tileFor } from "../lib/palette";

// Renders the aggregate payload pushed over the `results:updated` socket event.
// Shape depends on slide type — see server/src/services/aggregate.ts.
// `correctIndex`, when set, marks a MULTIPLE_CHOICE slide as a quiz question
// so the correct bar can be highlighted with a trophy.
export default function ResultsView({
  aggregate,
  correctIndex,
}: {
  aggregate: any;
  correctIndex?: number;
}) {
  if (!aggregate) return null;

  switch (aggregate.type) {
    case "MULTIPLE_CHOICE": {
      const data = aggregate.options.map((opt: string, i: number) => ({
        name: correctIndex === i ? `🏆 ${opt}` : opt,
        votes: aggregate.counts[i] ?? 0,
      }));
      return (
        <div className="w-full h-80">
          <p className="text-sm text-gray-400 mb-2 font-medium">{aggregate.total} response(s)</p>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontWeight: 600 }} />
              <Tooltip />
              <Bar dataKey="votes" radius={[0, 10, 10, 0]} isAnimationActive animationDuration={400}>
                {data.map((_: any, i: number) => (
                  <Cell
                    key={i}
                    fill={tileFor(i).solid}
                    stroke={correctIndex === i ? "#facc15" : undefined}
                    strokeWidth={correctIndex === i ? 3 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    case "WORD_CLOUD": {
      const max = Math.max(1, ...aggregate.words.map((w: any) => w.count));
      return (
        <div className="w-full">
          <p className="text-sm text-gray-400 mb-2 font-medium">{aggregate.total} response(s)</p>
          <div className="flex flex-wrap gap-4 items-center justify-center py-10 min-h-[200px]">
            {aggregate.words.map((w: any, i: number) => {
              const size = 18 + (w.count / max) * 56;
              return (
                <span
                  key={w.text}
                  style={{ fontSize: `${size}px`, color: tileFor(i).solid }}
                  className="font-black animate-pop-in"
                >
                  {w.text}
                </span>
              );
            })}
            {aggregate.words.length === 0 && (
              <p className="text-gray-400">Waiting for responses...</p>
            )}
          </div>
        </div>
      );
    }

    case "SCALE": {
      const bars = Object.entries(aggregate.distribution as Record<string, number>);
      return (
        <div className="w-full">
          <p className="text-sm text-gray-400 mb-2 font-medium">
            {aggregate.total} response(s) &middot; average{" "}
            <span className="font-bold text-brand">{aggregate.average.toFixed(2)}</span>
          </p>
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars.map(([k, v]) => ({ name: k, count: v }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontWeight: 600 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#5b47fb" radius={[8, 8, 0, 0]} isAnimationActive animationDuration={400} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }

    case "OPEN_ENDED": {
      return (
        <div className="w-full">
          <p className="text-sm text-gray-400 mb-2 font-medium">{aggregate.total} response(s)</p>
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
            {aggregate.texts.map((t: any, i: number) => (
              <div
                key={i}
                className="bg-gray-50 border-l-4 rounded-lg px-4 py-3 text-left font-medium animate-slide-up"
                style={{ borderColor: tileFor(i).solid }}
              >
                {t.text}
              </div>
            ))}
            {aggregate.texts.length === 0 && (
              <p className="text-gray-400 text-center py-8">Waiting for responses...</p>
            )}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}
