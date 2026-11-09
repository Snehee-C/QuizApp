import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getSocket } from "../../lib/socket";
import { spring } from "../../lib/motion";
import { Button } from "../ui/Button";
import { cn } from "../../lib/cn";

/** Mirrors the server payload in server/src/sockets/qa.ts. */
export interface QaQuestion {
  id: string;
  text: string;
  authorName: string;
  status: "PENDING" | "APPROVED" | "ANSWERED" | "HIDDEN";
  votes: number;
  createdAt: number;
  /** Whether THIS participant has upvoted it — stamped per socket by the server. */
  mine: boolean;
}

interface QaPanelProps {
  joinCode: string;
  participantId: string;
  name: string;
}

/** Server-enforced too (qa.ts slices at 280) — mirrored so the counter is honest. */
const MAX_LEN = 280;

/**
 * Upvote glyph. The filled/outlined distinction carries the state on its own,
 * so "have I voted" survives greyscale and every form of CVD — the accent fill
 * is the second, redundant channel (DESIGN.md §5).
 */
function UpArrow({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 4.5 20.5 18.5H3.5L12 4.5Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M4 12.5 9.5 18 20 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The audience's Q&A deck. Always Stage Dark: it is held 40cm from the face in
 * a room that is usually dim (DESIGN.md §5).
 */
export function QaPanel({ joinCode, participantId, name }: QaPanelProps) {
  const [questions, setQuestions] = useState<QaQuestion[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const socket = getSocket();
    let live = true;
    let pushed = false;

    const onUpdated = (payload: { questions?: QaQuestion[] }) => {
      pushed = true;
      setQuestions(payload?.questions ?? []);
    };

    // Seed, then stay in sync. The seed is dropped if a broadcast already beat
    // it home — a late ack must never overwrite fresher state.
    socket.emit("qa:list", { joinCode, participantId }, (res: any) => {
      if (!live || pushed || !res?.ok) return;
      setQuestions(res.questions ?? []);
    });
    socket.on("qa:updated", onUpdated);

    // Off by handler reference: the panel, the host moderation list and the
    // stage view all listen on "qa:updated", and a bare off() would silently
    // unsubscribe the others.
    return () => {
      live = false;
      socket.off("qa:updated", onUpdated);
    };
  }, [joinCode, participantId]);

  const remaining = MAX_LEN - text.length;
  const canSend = text.trim().length > 0 && !sending;

  function send() {
    if (!canSend) return;
    setSending(true);
    setError("");
    getSocket().emit(
      "qa:ask",
      { joinCode, participantId, name, text: text.trim() },
      (res: any) => {
        setSending(false);
        if (res?.error) {
          setError(res.error);
          return;
        }
        setText("");
        boxRef.current?.focus();
      }
    );
  }

  function toggleVote(questionId: string) {
    getSocket().emit("qa:vote", { joinCode, participantId, questionId }, (res: any) => {
      if (res?.error) setError(res.error);
    });
  }

  // The server decides visibility now: a participant receives everything
  // approved plus their OWN pending questions, so unmoderated text from other
  // people never arrives here in the first place. Filtering again on a name
  // match would be worse than redundant — identical nicknames, or a name the
  // server truncated, would hide a player's own question from them.
  const visible = questions;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-surface-1 rounded-lg shadow-elev-1 p-4 flex flex-col gap-3">
        <label htmlFor="qa-compose" className="block text-caption font-semibold uppercase track-label text-ink-subtle">
          Ask the host
        </label>
        <textarea
          id="qa-compose"
          ref={boxRef}
          value={text}
          maxLength={MAX_LEN}
          rows={3}
          placeholder="What do you want to know?"
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          className={cn(
            "w-full bg-surface-2 text-ink placeholder:text-ink-subtle font-ui text-callout",
            "rounded-md px-4 py-3 shadow-line outline-none resize-none",
            "transition-shadow duration-fast ease-standard",
            "focus:shadow-[var(--line),var(--focus)]"
          )}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="nums text-footnote text-ink-subtle" aria-live="polite">
            {remaining} left
          </span>
          <Button variant="primary" size="md" onClick={send} disabled={!canSend}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-footnote text-warn">
            {error}
          </p>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="bg-surface-1 rounded-lg shadow-line px-4 py-8 text-center">
          <p className="text-subhead text-ink-muted">No questions yet.</p>
          <p className="text-footnote text-ink-subtle mt-1">
            Ask the first one — the most upvoted questions rise to the top.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {visible.map((q) => {
              const isPending = q.status === "PENDING";
              const isAnswered = q.status === "ANSWERED";
              return (
                <motion.li
                  key={q.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={spring.default}
                  className={cn(
                    "bg-surface-1 rounded-lg shadow-elev-1 p-3 flex items-start gap-3",
                    // Pending reads as provisional: dashed edge + the chip below,
                    // never a colour change on its own.
                    isPending && "shadow-none outline outline-1 outline-dashed outline-[var(--hairline)]",
                    isAnswered && "opacity-60"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleVote(q.id)}
                    aria-pressed={q.mine}
                    aria-label={q.mine ? "Remove your upvote" : "Upvote this question"}
                    className={cn(
                      "shrink-0 min-h-11 min-w-11 px-2 rounded-md",
                      "flex flex-col items-center justify-center gap-0.5",
                      "transition-[filter,background-color,color] duration-instant ease-standard brighten active:scale-[0.97]",
                      q.mine
                        ? "bg-accent text-accent-ink"
                        : "bg-surface-2 text-ink-muted shadow-line"
                    )}
                  >
                    <UpArrow filled={q.mine} />
                    <span className="nums text-footnote font-semibold leading-none">{q.votes}</span>
                  </button>

                  <div className="min-w-0 flex-1">
                    {/* Audience-authored: rendered as a text node, never as markup. */}
                    <p className="text-subhead text-ink break-words whitespace-pre-wrap">{q.text}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-footnote text-ink-subtle">{q.authorName}</span>
                      {isPending ? (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-caption2 font-semibold uppercase track-label text-ink-muted">
                          Waiting for the host
                        </span>
                      ) : null}
                      {isAnswered ? (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-caption2 font-semibold uppercase track-label text-ink-muted">
                          <CheckGlyph />
                          Answered
                        </span>
                      ) : null}
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

export default QaPanel;
