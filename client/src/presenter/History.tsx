import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "motion/react";
import { api, type SessionSummary } from "../lib/api";
import { downloadSessionCsv } from "../lib/sessionExport";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { AppHeader } from "../components/AppHeader";
import { duration as dur, STAGGER, prefersReducedMotion } from "../lib/motion";
import { cn } from "../lib/cn";
import { useScrollMemory } from "../lib/scrollMemory";

// "7 Nov, 14:32" — day + month + 24h clock. No year: the overwhelming majority
// of runs a host looks back at are recent, and the year is noise in a list.
const WHEN = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Unknown" : WHEN.format(d);
}

// Rounded to the unit a host actually cares about. A session is a human event,
// so "12 min" beats "11 min 47 s" every time.
function formatDuration(startedAt: string, endedAt: string): string | null {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} sec`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

const STATUS_LABEL: Record<SessionSummary["status"], string> = {
  LOBBY: "Never started",
  ACTIVE: "Still running",
  ENDED: "Ended",
};

export default function History() {
  const { id } = useParams<{ id: string }>();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-row so one slow or failed export never freezes the whole list.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [exportError, setExportError] = useState<string | null>(null);
  // Keyed by deck: two decks' histories are two different places.
  useScrollMemory(`history:${id}`, !loading);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setLoading(true);
    setError(null);

    // The deck title is decoration, so it must not be able to fail the page.
    api
      .getPresentation(id)
      .then((p) => live && setTitle(p.title))
      .catch(() => {});

    api
      .listSessions(id)
      .then((data) => {
        if (!live) return;
        setSessions(
          [...data].sort(
            (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
          )
        );
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load sessions.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [id]);

  async function downloadCsv(s: SessionSummary) {
    setBusy((b) => ({ ...b, [s.id]: true }));
    setExportError(null);
    try {
      await downloadSessionCsv(s.id, s.joinCode);
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy((b) => ({ ...b, [s.id]: false }));
    }
  }

  const reduced = prefersReducedMotion();

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <AppHeader
        crumb={
          /* A trail, not a single door.

             A deck's history sits under that deck, which sits under Decks —
             but the one control here used to be "Back to decks", which threw
             a host who arrived from the editor two levels up and left them to
             find their way back in. Reaching this page from two places
             (the editor and the dashboard) means a single "back" cannot be
             right for both; naming the whole path is right for both, and it
             also answers "where am I" without anyone having to press
             anything (NN/g: recognition over recall). */
          <nav aria-label="Breadcrumb" className="min-w-0 flex items-center gap-2 text-subhead">
            <Link
              to="/dashboard"
              className="shrink-0 text-ink-subtle hover:text-ink transition-colors duration-fast rounded-xs outline-none focus-visible:shadow-focus"
            >
              Decks
            </Link>
            <span className="text-ink-subtle shrink-0" aria-hidden="true">
              /
            </span>
            <Link
              to={id ? `/edit/${id}` : "/dashboard"}
              // A floor, so a long title squeezed by the shell's nav still
              // shows its first letters and an ellipsis rather than nothing.
              className="min-w-16 truncate text-ink-subtle hover:text-ink transition-colors duration-fast rounded-xs outline-none focus-visible:shadow-focus"
            >
              {title ?? "Deck"}
            </Link>
            <span className="text-ink-subtle shrink-0" aria-hidden="true">
              /
            </span>
            <span className="shrink-0 font-semibold text-ink" aria-current="page">
              History
            </span>
          </nav>
        }
        actions={
          <>
            {/* The one-way spoke, closed (UX-PLAN 0.5): a session's results
                are exactly where a bad question announces itself, and the
                editor used to be three presses and a scan from here. */}
            <Link to={id ? `/edit/${id}` : "/dashboard"} className="shrink-0">
              <Button variant="ghost" size="sm">
                Edit deck
              </Button>
            </Link>
            <Link to={id ? `/present/${id}` : "/dashboard"} className="shrink-0">
              <Button variant="secondary" size="sm">
                Present
              </Button>
            </Link>
          </>
        }
      />

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-10">
        <div className="mb-7">
          {/* The deck's name is in the breadcrumb above; repeating it here
              would be two spellings of the same fact (DESIGN.md P1). */}
          <h1 className="font-display text-large-title font-bold leading-none">
            Session history
          </h1>
        </div>

        {loading && <p className="text-ink-subtle">Loading…</p>}

        {!loading && error && (
          <Card level={0} className="px-7 py-10 text-center">
            <p className="font-display text-title2 font-bold mb-2">
              Couldn’t load this deck’s history
            </p>
            <p className="text-ink-subtle text-subhead">{error}</p>
          </Card>
        )}

        {!loading && !error && sessions.length === 0 && (
          <Card level={0} className="px-7 py-12 text-center">
            <p className="font-display text-title2 font-bold mb-2">
              This deck hasn’t been run yet
            </p>
            <p className="text-ink-subtle text-subhead mb-6">
              Every time you present it, the run lands here with its results ready to export.
            </p>
            <Link to={id ? `/present/${id}` : "/dashboard"}>
              <Button variant="primary" size="md">
                Present it now
              </Button>
            </Link>
          </Card>
        )}

        {exportError && (
          <p className="text-subhead text-ink-muted mb-3" role="status">
            {exportError}
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          {sessions.map((s, i) => {
            const length = s.endedAt ? formatDuration(s.startedAt, s.endedAt) : null;
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: reduced ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * STAGGER, duration: dur.base }}
              >
                <Card
                  level={1}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="code font-semibold text-callout">{s.joinCode}</p>
                    <p className="nums text-footnote text-ink-subtle mt-0.5">
                      {formatWhen(s.startedAt)}
                      {" · "}
                      {/* A null endedAt means the run was abandoned rather than
                          closed, so there is no honest duration to show. */}
                      {length ? (
                        <span>{length}</span>
                      ) : (
                        <span className={cn(s.status === "ACTIVE" && "text-accent")}>
                          {STATUS_LABEL[s.status]} — no duration recorded
                        </span>
                      )}
                    </p>
                  </div>

                  <dl className="flex items-center gap-5 text-footnote">
                    <Stat label="Players" value={s.participants} />
                    <Stat label="Questions" value={s.questions} />
                    <Stat label="Responses" value={s.responses} />
                  </dl>

                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!!busy[s.id]}
                    onClick={() => downloadCsv(s)}
                  >
                    {busy[s.id] ? "Preparing…" : "Download CSV"}
                  </Button>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-caption2 uppercase track-label text-ink-subtle">{label}</dt>
      <dd className="nums text-ink-muted font-semibold">{value}</dd>
    </div>
  );
}
