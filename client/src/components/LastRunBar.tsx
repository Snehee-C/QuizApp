import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { getToken } from "../lib/api";
import { API_BASE } from "../lib/config";
import { clearLastRun, getLastRun } from "../lib/liveSession";
import { Button } from "./ui/Button";
import { cn } from "../lib/cn";
import { duration as dur, prefersReducedMotion } from "../lib/motion";

/**
 * "You just ran this. Here are the results."
 *
 * The final-results screen now offers Download / Present again / Edit / Done,
 * but all four vanish the moment the host takes one of them — and the one they
 * most often want next, the CSV, is the one they usually want a minute LATER,
 * after they have stopped presenting and sat down. From the deck list that
 * cost three presses and a scan through every deck they own.
 *
 * So the ending follows them one screen forward. It is deliberately a single
 * strip with two verbs and a dismiss, not a feed: "recent activity" is a
 * different product, and the honest scope of what this knows is one run.
 */
export function LastRunBar({
  title,
  contentClassName,
}: {
  /** The deck's name, resolved by the caller — the crumb stores only an id. */
  title?: string;
  contentClassName?: string;
}) {
  const [run, setRun] = useState(getLastRun);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!run) return null;
  const reduced = prefersReducedMotion();

  // The export endpoint is authenticated, so it cannot be a plain <a href>:
  // the bearer token has to be attached and the browser handed a blob. Same
  // mechanism as the History page, pointed at the session we just finished.
  async function download() {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${run.sessionId}/export`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `session-${run.joinCode}-results.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.base }}
      className="shrink-0 border-b border-hairline bg-surface-1"
    >
      <div className={cn("px-5 py-2.5 flex items-center justify-between gap-4", contentClassName)}>
        <p className="min-w-0 flex items-baseline gap-2 text-subhead">
          <span className="font-semibold shrink-0 text-ink">You just ran</span>
          <span className="truncate text-ink">{title ?? "a deck"}</span>
          <span className="shrink-0 text-ink-subtle">
            — room <span className="code">{run.joinCode}</span>
          </span>
        </p>
        <div className="shrink-0 flex items-center gap-1.5">
          {error && (
            <span role="status" className="text-footnote text-ink-muted mr-1">
              {error}
            </span>
          )}
          <Button variant="secondary" size="sm" disabled={busy} onClick={download}>
            {busy ? "Preparing…" : "Download results"}
          </Button>
          <Link to={`/history/${run.deckId}`}>
            <Button variant="ghost" size="sm">
              All runs
            </Button>
          </Link>
          {/* Dismissible, because this is the product remembering something
              FOR you — and anything that volunteers itself has to be
              dismissible or it is nagging. */}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Dismiss"
            onClick={() => {
              clearLastRun();
              setRun(null);
            }}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
