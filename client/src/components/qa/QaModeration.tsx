import { useEffect, useState } from "react";
import { getSocket } from "../../lib/socket";
import { getToken } from "../../lib/api";
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
  mine: boolean;
}

interface QaModerationProps {
  joinCode: string;
}

type Status = QaQuestion["status"];

// Pending first: triage order, not vote order. The host's job here is to clear
// the queue, and anything already approved needs no decision.
const GROUPS: { status: Status; label: string; hint: string }[] = [
  { status: "PENDING", label: "Needs review", hint: "Not on the big screen yet" },
  { status: "APPROVED", label: "On the stage", hint: "Visible to the room" },
  { status: "ANSWERED", label: "Answered", hint: "Marked done" },
];

function StatusMark({ status }: { status: Status }) {
  // Shape + word, so status never rests on colour alone (DESIGN.md §5).
  const glyph = status === "ANSWERED" ? "✓" : status === "APPROVED" ? "●" : "○";
  const word = status === "ANSWERED" ? "Answered" : status === "APPROVED" ? "Live" : "Pending";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5",
        "text-caption2 font-semibold uppercase track-label",
        status === "APPROVED" ? "bg-surface-3 text-accent" : "bg-surface-2 text-ink-muted"
      )}
    >
      <span aria-hidden="true">{glyph}</span>
      {word}
    </span>
  );
}

/**
 * Host-side triage. This is control chrome read at desk distance, so it uses
 * normal UI sizing and the AA target — not the stage scale (DESIGN.md §6).
 */
export function QaModeration({ joinCode }: QaModerationProps) {
  const [questions, setQuestions] = useState<QaQuestion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

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

    // Off by handler reference — QaPanel and QaStage share this event.
    return () => {
      live = false;
      socket.off("qa:updated", onUpdated);
    };
  }, [joinCode]);

  function moderate(questionId: string, status: Status) {
    setBusyId(questionId);
    setError("");
    getSocket().emit(
      "qa:moderate",
      { joinCode, token: getToken(), questionId, status },
      (res: any) => {
        setBusyId(null);
        if (res?.error) setError(res.error);
      }
    );
  }

  const total = questions.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-body font-semibold text-ink">
          Audience questions
        </h2>
        <span className="nums text-footnote text-ink-subtle">{total}</span>
      </div>

      {error ? (
        <p role="alert" className="text-footnote text-warn">
          {error}
        </p>
      ) : null}

      {total === 0 ? (
        <div className="bg-surface-1 rounded-md shadow-line px-4 py-6 text-center">
          <p className="text-subhead text-ink-muted">Nothing asked yet.</p>
          <p className="text-caption text-ink-subtle mt-1">
            Questions land here the moment someone sends one.
          </p>
        </div>
      ) : (
        GROUPS.map(({ status, label, hint }) => {
          const rows = questions.filter((q) => q.status === status);
          if (rows.length === 0) return null;
          return (
            <section key={status} className="flex flex-col gap-2">
              <header className="flex items-baseline gap-2">
                <h3 className="text-caption font-semibold uppercase track-label text-ink-subtle">
                  {label}
                </h3>
                <span className="nums text-caption text-ink-subtle">{rows.length}</span>
                <span className="text-caption text-ink-subtle ml-auto">{hint}</span>
              </header>

              <ul className="flex flex-col gap-2">
                {rows.map((q) => (
                  <li
                    key={q.id}
                    className={cn(
                      "bg-surface-1 rounded-md shadow-elev-1 p-3 flex items-start gap-3",
                      q.status === "ANSWERED" && "opacity-70"
                    )}
                  >
                    <div className="shrink-0 w-12 text-center">
                      <div className="nums text-body font-semibold text-ink leading-none">
                        {q.votes}
                      </div>
                      <div className="text-caption2 uppercase track-label text-ink-subtle mt-1">
                        {q.votes === 1 ? "vote" : "votes"}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Audience-authored: text node only, never markup. */}
                      <p className="text-subhead text-ink break-words whitespace-pre-wrap">
                        {q.text}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-caption text-ink-subtle">{q.authorName}</span>
                        <StatusMark status={q.status} />
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5">
                      {q.status !== "APPROVED" ? (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busyId === q.id}
                          onClick={() => moderate(q.id, "APPROVED")}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {q.status !== "ANSWERED" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === q.id}
                          onClick={() => moderate(q.id, "ANSWERED")}
                        >
                          Mark answered
                        </Button>
                      ) : null}
                      {/* Terminal: the server drops HIDDEN from every list, so a
                          hidden question cannot be recovered from this UI. */}
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busyId === q.id}
                        onClick={() => moderate(q.id, "HIDDEN")}
                      >
                        Hide
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

export default QaModeration;
