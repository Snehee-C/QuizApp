import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { autosave, useAutosaveState } from "../lib/autosave";
import { formatRelative } from "../lib/relativeTime";

/**
 * "Saved · just now."
 *
 * The visible half of lib/autosave.ts. One line of desk-distance type in the
 * header, and the only place the editor ever says whether what you see is
 * what the server has (PULSE.md T2).
 *
 * The timing is the design. A healthy save takes well under a second, and an
 * indicator that flashes "Saving…" on every keystroke is itself a defect —
 * T1's inverse clause: progress surfaces are delayed past ~400 ms so that
 * when they do appear they are true. So:
 *
 *   clean                        Saved · just now        (then · 2 min ago)
 *   dirty < 400 ms               the previous line, unchanged
 *   dirty ≥ 400 ms               Saving…
 *   a write failed               Couldn't save — retrying
 *   failed and the browser is    Offline — changes will save when you're back
 *   offline
 *
 * "Saved" is only ever written after an acknowledgement. Nothing here is
 * optimistic, because an optimistic "Saved" is the lie this exists to end.
 *
 * `role="status"`, polite: a screen-reader user hears the failure once and
 * the recovery once, and never hears "Saved" on every pause in their typing —
 * the healthy transitions are visual only, by rendering them without changing
 * the live region's text until the state is worth announcing.
 */
const SHOW_SAVING_AFTER_MS = 400;
const NOTICE_MS = 6000;

export function SaveIndicator({ className }: { className?: string }) {
  const s = useAutosaveState();
  const [now, setNow] = useState(() => Date.now());

  // Re-render exactly when the label would change: at the 400 ms mark of a
  // dirty stretch, and once a minute while clean so "just now" ages honestly.
  useEffect(() => {
    if (s.dirtySince !== null) {
      const due = s.dirtySince + SHOW_SAVING_AFTER_MS - Date.now();
      if (due <= 0) return;
      const t = window.setTimeout(() => setNow(Date.now()), due + 10);
      return () => window.clearTimeout(t);
    }
    if (s.lastSavedAt === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [s.dirtySince, s.lastSavedAt]);

  // A one-shot notice ("Couldn't add the slide") has no retry to resolve it,
  // so it leaves on its own after a reading's worth of time.
  useEffect(() => {
    if (!s.notice) return;
    const id = s.notice.id;
    const t = window.setTimeout(() => autosave.clearNotice(id), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [s.notice]);

  let text: string | null = null;
  let tone: "quiet" | "warn" = "quiet";

  if (s.notice) {
    text = s.notice.message;
    tone = "warn";
  } else if (s.failed) {
    text = s.online ? "Couldn't save — retrying" : "Offline — changes will save when you're back";
    tone = "warn";
  } else if (s.dirtySince !== null && Math.max(now, Date.now()) - s.dirtySince >= SHOW_SAVING_AFTER_MS) {
    text = "Saving…";
  } else if (s.lastSavedAt !== null) {
    text = `Saved · ${formatRelative(new Date(s.lastSavedAt).toISOString(), now)}`;
  }

  // The live region is always mounted so its first announcement is a change,
  // not an appearance — some readers skip a region that arrives with text.
  return (
    <span
      role="status"
      aria-live="polite"
      data-save-state={s.notice ? "notice" : s.failed ? "failed" : text === "Saving…" ? "saving" : "saved"}
      className={cn(
        "text-footnote whitespace-nowrap tabular-nums transition-colors duration-base",
        tone === "warn" ? "text-warn font-medium" : "text-ink-subtle",
        className
      )}
    >
      {text}
    </span>
  );
}
