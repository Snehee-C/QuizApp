import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getSocket } from "../../lib/socket";
import { spring } from "../../lib/motion";
import { cn } from "../../lib/cn";

/** Mirrors the server payload in server/src/sockets/qa.ts. */
export interface QaQuestion {
  id: string;
  text: string;
  authorName: string;
  status: "PENDING" | "APPROVED" | "ANSWERED" | "HIDDEN";
  votes: number;
  createdAt: number;
  mine: boolean;
}

interface QaStageProps {
  joinCode: string;
}

/**
 * An allowlist, deliberately — not `status !== "PENDING"`. Anything the server
 * ever adds to the status enum stays off the projector until this list says
 * otherwise, which is the safe direction for unmoderated audience text.
 */
const ON_STAGE: QaQuestion["status"][] = ["APPROVED", "ANSWERED"];

// The room reads the top of the list, not the bottom. Capping beats scrolling
// or shrinking past the 24px floor (DESIGN.md §5).
const MAX_ON_STAGE = 6;

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="0.8em" height="0.8em" aria-hidden="true">
      <path
        d="M4 12.5 9.5 18 20 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The big screen. Only moderator-approved text ever reaches it.
 */
export function QaStage({ joinCode }: QaStageProps) {
  const [questions, setQuestions] = useState<QaQuestion[]>([]);

  useEffect(() => {
    const socket = getSocket();
    let live = true;
    let pushed = false;

    const onUpdated = (payload: { questions?: QaQuestion[] }) => {
      pushed = true;
      setQuestions(payload?.questions ?? []);
    };

    // A late seed ack must not overwrite a broadcast that already landed.
    socket.emit("qa:list", { joinCode }, (res: any) => {
      if (!live || pushed || !res?.ok) return;
      setQuestions(res.questions ?? []);
    });
    socket.on("qa:updated", onUpdated);

    // Off by handler reference — QaPanel and QaModeration share this event.
    return () => {
      live = false;
      socket.off("qa:updated", onUpdated);
    };
  }, [joinCode]);

  // Server order is already votes-desc, ties oldest-first; the filter preserves it.
  const showable = questions.filter((q) => ON_STAGE.includes(q.status));
  const visible = showable.slice(0, MAX_ON_STAGE);
  const overflow = showable.length - visible.length;

  return (
    <div className="w-full h-full flex flex-col px-stage-safe py-stage-safe">
      <h2 className="text-stage-label font-semibold uppercase track-label text-ink-subtle">
        Audience questions
      </h2>

      {visible.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <p className="text-stage-q font-display text-ink-muted">
            No questions yet
          </p>
          <p className="text-stage-answer text-ink-subtle mt-stage-gap">
            Send one from your phone.
          </p>
        </div>
      ) : (
        <ul className="flex-1 flex flex-col justify-center gap-stage-gap">
          <AnimatePresence initial={false}>
            {visible.map((q) => {
              const answered = q.status === "ANSWERED";
              return (
                <motion.li
                  key={q.id}
                  layout
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: answered ? 0.45 : 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={spring.default}
                  className={cn(
                    "flex items-start gap-stage-gap rounded-xl bg-surface-1 shadow-elev-1",
                    "px-[2vw] py-[1.4vw]"
                  )}
                >
                  <div className="shrink-0 text-center min-w-[3.2em]">
                    <div
                      className={cn(
                        "nums text-stage-name font-semibold leading-none",
                        answered ? "text-ink-muted" : "text-accent"
                      )}
                    >
                      {q.votes}
                    </div>
                    <div className="text-stage-label uppercase track-label text-ink-subtle">
                      {q.votes === 1 ? "vote" : "votes"}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Audience-authored: text node only, never markup. */}
                    <p
                      className={cn(
                        "text-stage-answer font-display break-words",
                        answered ? "text-ink-muted line-through decoration-2" : "text-ink"
                      )}
                    >
                      {q.text}
                    </p>
                    <div className="mt-[0.5vw] flex items-center gap-[1vw] text-stage-label text-ink-subtle">
                      <span>{q.authorName}</span>
                      {/* Done is marked by a check and a word as well as the dim,
                          so it never rests on contrast alone (DESIGN.md §5). */}
                      {answered ? (
                        <span className="inline-flex items-center gap-[0.4em] uppercase track-label">
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

      {overflow > 0 ? (
        <p className="text-stage-label text-ink-subtle text-center">
          <span className="nums">+{overflow}</span> more waiting
        </p>
      ) : null}
    </div>
  );
}

export default QaStage;
