// "updated 3 d ago" — the sort key the deck list was always ordered by and
// never showed (UX-PLAN 0.2 / 6.2). A list sorted by a hidden property reads
// as unsorted; surfacing the key is what makes the order legible.
//
// Coarse on purpose: a host asks "is this the one I touched this week", not
// "at what minute". Past about a month the day itself is the answer, so it
// falls back to a date — the same day-month shape History uses.

const DAY_MONTH = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatRelative(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "unknown";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w} wk ago`;
  const then = new Date(t);
  return (then.getFullYear() === new Date(now).getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(
    then
  );
}
