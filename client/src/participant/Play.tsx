import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getNickname, getParticipantId, getSocket, setNickname } from "../lib/socket";
import { tileFor } from "../lib/palette";
import { Podium, LeaderboardList, type LeaderboardEntry } from "../components/Podium";

interface CurrentSlide {
  id: string;
  type: string;
  question: string;
  config: any;
  order: number;
}

interface SubmitFeedback {
  isQuiz: boolean;
  correct?: boolean;
  points?: number;
  totalScore?: number;
  rank?: number;
}

export default function Play() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const participantId = useRef(getParticipantId());
  const [name, setName] = useState(getNickname());
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState<"LOBBY" | "ACTIVE" | "ENDED">("LOBBY");
  const [currentSlide, setCurrentSlide] = useState<CurrentSlide | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<SubmitFeedback | null>(null);
  const [ended, setEnded] = useState(false);
  const [finalEntries, setFinalEntries] = useState<LeaderboardEntry[]>([]);
  // Set only while the presenter has the leaderboard "on screen" — mirrors
  // the presenter's big-screen leaderboard moment onto every phone.
  const [leaderboardView, setLeaderboardView] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    socket.emit(
      "participant:join",
      { joinCode: code, participantId: participantId.current, name },
      (res: any) => {
        if (res?.error) {
          setError(res.error);
          return;
        }
        setStatus(res.status);
        setCurrentSlide(res.currentSlide);
        setStartedAt(res.startedAt ?? null);
      }
    );

    socket.on("slide:changed", (payload) => {
      setStatus(payload.status);
      setCurrentSlide(payload.currentSlide);
      setStartedAt(payload.startedAt ?? null);
      setFeedback(null);
      setLeaderboardView(null);
    });

    socket.on("leaderboard:show", (payload) => {
      setLeaderboardView(payload.entries ?? []);
    });
    socket.on("leaderboard:hide", () => {
      setLeaderboardView(null);
    });

    socket.on("session:ended", (payload) => {
      setEnded(true);
      setFinalEntries(payload?.entries ?? []);
    });

    return () => {
      socket.off("slide:changed");
      socket.off("leaderboard:show");
      socket.off("leaderboard:hide");
      socket.off("session:ended");
    };
  }, [code, joined, name]);

  function submit(value: unknown) {
    if (!currentSlide) return;
    getSocket().emit(
      "participant:submit",
      {
        joinCode: code,
        slideId: currentSlide.id,
        participantId: participantId.current,
        value,
      },
      (res: any) => {
        if (!res?.error) setFeedback(res);
      }
    );
  }

  if (!joined) {
    return (
      <NicknameGate
        initialName={name}
        onJoin={(n) => {
          setNickname(n);
          setName(n);
          setJoined(true);
        }}
      />
    );
  }

  if (error) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center gap-4 px-4 text-center bg-white">
        <p className="text-rose-500 font-semibold text-lg">{error}</p>
        <button
          onClick={() => navigate("/join")}
          className="text-brand bg-brand/5 hover:bg-brand/10 px-5 py-2 rounded-full transition font-medium"
        >
          Try another code
        </button>
      </div>
    );
  }

  if (ended) {
    const mine = finalEntries.find((e) => e.participantId === participantId.current);
    const myRank = mine ? finalEntries.indexOf(mine) + 1 : null;
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center px-4 text-center gap-6 bg-white overflow-y-auto">
        <p className="text-3xl font-black text-gray-900">🎉 Session ended!</p>
        {finalEntries.length > 0 && <Podium entries={finalEntries} />}
        {mine && (
          <p className="text-gray-500">
            You finished <span className="font-bold text-gray-900">#{myRank}</span> with{" "}
            <span className="font-bold text-gray-900">{mine.score}</span> points
          </p>
        )}
        <p className="text-gray-400 text-sm">Thanks for joining!</p>
      </div>
    );
  }

  // The presenter revealed the leaderboard — show it here too, regardless of
  // what slide/status we're otherwise in.
  if (leaderboardView) {
    const mine = leaderboardView.find((e) => e.participantId === participantId.current);
    const myRank = mine ? leaderboardView.indexOf(mine) + 1 : null;
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center px-4 text-center gap-4 bg-white overflow-y-auto py-6">
        <p className="text-2xl font-black text-gray-900">🏆 Leaderboard</p>
        {leaderboardView.length >= 3 && <Podium entries={leaderboardView.slice(0, 3)} />}
        <div className="w-full max-w-sm">
          <LeaderboardList entries={leaderboardView} />
        </div>
        {mine && (
          <p className="text-gray-500 text-sm">
            You're <span className="font-bold text-gray-900">#{myRank}</span> with{" "}
            <span className="font-bold text-gray-900">{mine.score}</span> pts
          </p>
        )}
      </div>
    );
  }

  if (status === "LOBBY" || !currentSlide) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center gap-4 px-4 text-center bg-white">
        <div className="w-16 h-16 rounded-full border-4 border-gray-200 border-t-brand animate-spin" />
        <p className="text-gray-900 text-2xl font-bold">You're in, {name}! 🙌</p>
        <p className="text-gray-500">Waiting for the presenter to start...</p>
      </div>
    );
  }

  const isQuiz = currentSlide.type === "MULTIPLE_CHOICE" && currentSlide.config?.isQuiz;

  return (
    // h-[100dvh] (not min-h-screen/100vh) + overflow-hidden on the outer shell
    // keeps the timer+question pinned in view on mobile — 100vh on phones
    // includes the space behind the address bar, which was pushing the
    // question off the top of the visible area and forcing a scroll-up.
    <div className="h-[100dvh] flex flex-col items-center px-4 py-4 gap-3 bg-white overflow-hidden">
      {isQuiz && !feedback && (
        <QuizTimer
          key={currentSlide.id}
          startedAt={startedAt}
          timeLimitSec={currentSlide.config.timeLimitSec ?? 20}
        />
      )}

      <p
        key={currentSlide.id + "-q"}
        className="text-xl font-extrabold text-center text-gray-900 animate-slide-up max-w-md flex-shrink-0"
      >
        {currentSlide.question}
      </p>

      <div className="flex-1 min-h-0 w-full flex items-center justify-center overflow-y-auto py-1">
        {feedback ? (
          <FeedbackCard feedback={feedback} />
        ) : (
          <AnswerInput key={currentSlide.id} slide={currentSlide} onSubmit={submit} />
        )}
      </div>
    </div>
  );
}

function NicknameGate({ initialName, onJoin }: { initialName: string; onJoin: (name: string) => void }) {
  const [value, setValue] = useState(initialName);
  return (
    <div className="h-[100dvh] flex items-center justify-center px-4 bg-white">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const clean = value.trim().slice(0, 24);
          if (clean) onJoin(clean);
        }}
        className="w-full max-w-xs flex flex-col gap-5 text-center animate-slide-up"
      >
        <h1 className="text-3xl font-black text-gray-900">What's your name?</h1>
        <input
          className="border-2 border-gray-200 bg-white text-gray-900 placeholder-gray-300 rounded-2xl px-4 py-4 text-center text-2xl font-bold focus:border-brand focus:outline-none transition"
          placeholder="Nickname"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={24}
          autoFocus
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="bg-brand text-white rounded-full py-4 font-bold text-lg hover:bg-brand-dark active:scale-95 transition disabled:opacity-40 shadow-lg shadow-brand/20"
        >
          Let's go 🚀
        </button>
      </form>
    </div>
  );
}

function QuizTimer({ startedAt, timeLimitSec }: { startedAt: number | null; timeLimitSec: number }) {
  const [remaining, setRemaining] = useState(timeLimitSec);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setRemaining(Math.max(0, timeLimitSec - elapsed));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [startedAt, timeLimitSec]);

  const pct = Math.max(0, Math.min(100, (remaining / timeLimitSec) * 100));
  const urgent = remaining <= 5;

  return (
    <div className="w-full max-w-md flex-shrink-0">
      <div className="flex justify-between text-xs text-gray-500 mb-1 font-medium">
        <span>⏱️ Time left</span>
        <span className={urgent ? "text-rose-500 font-bold" : ""}>{Math.ceil(remaining)}s</span>
      </div>
      <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-100 ${
            urgent ? "bg-rose-500" : "bg-emerald-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function FeedbackCard({ feedback }: { feedback: SubmitFeedback }) {
  if (!feedback.isQuiz) {
    return (
      <div className="text-center gap-3 flex flex-col items-center animate-bounce-in">
        <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center text-4xl shadow-lg shadow-emerald-500/30">
          ✓
        </div>
        <p className="text-gray-900 text-xl font-bold">Nice! Answer submitted</p>
        <p className="text-gray-400 text-sm">Waiting for the next question...</p>
      </div>
    );
  }

  const correct = feedback.correct;
  return (
    <div className="text-center gap-3 flex flex-col items-center animate-bounce-in">
      <div
        className={`w-24 h-24 rounded-full flex items-center justify-center text-5xl shadow-lg ${
          correct ? "bg-emerald-500 shadow-emerald-500/40" : "bg-rose-500 shadow-rose-500/40"
        }`}
      >
        {correct ? "🎉" : "❌"}
      </div>
      <p className="text-gray-900 text-2xl font-black">{correct ? "Correct!" : "Not quite"}</p>
      {correct && <p className="text-emerald-500 text-xl font-bold">+{feedback.points} points</p>}
      <p className="text-gray-500 text-sm">
        Total: <span className="font-bold text-gray-900">{feedback.totalScore}</span> pts &middot; Rank{" "}
        <span className="font-bold text-gray-900">#{feedback.rank}</span>
      </p>
      <p className="text-gray-400 text-xs mt-1">Waiting for the next question...</p>
    </div>
  );
}

function AnswerInput({
  slide,
  onSubmit,
}: {
  slide: CurrentSlide;
  onSubmit: (value: unknown) => void;
}) {
  if (slide.type === "MULTIPLE_CHOICE") {
    const options: string[] = slide.config?.options ?? [];
    return (
      <div className="w-full max-w-md grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {options.map((opt, i) => {
          const tile = tileFor(i);
          return (
            <button
              key={i}
              onClick={() => onSubmit(i)}
              className={`bg-gradient-to-br ${tile.gradient} text-white rounded-2xl py-5 px-4 font-bold text-base shadow-lg active:scale-95 transition-transform flex flex-col items-center gap-1.5 animate-pop-in`}
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
            >
              <span className="text-xl">{tile.shape}</span>
              <span>{opt}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (slide.type === "SCALE") {
    const min = slide.config?.scaleMin ?? 1;
    const max = slide.config?.scaleMax ?? 5;
    const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    return (
      <div className="flex gap-3 flex-wrap justify-center max-w-md">
        {nums.map((n, i) => (
          <button
            key={n}
            onClick={() => onSubmit(n)}
            style={{ animationDelay: `${i * 50}ms`, animationFillMode: "backwards" }}
            className="w-14 h-14 rounded-full bg-white border-2 border-gray-200 text-gray-700 font-extrabold text-lg hover:bg-brand hover:border-brand hover:text-white transition active:scale-90 animate-pop-in"
          >
            {n}
          </button>
        ))}
      </div>
    );
  }

  if (slide.type === "WORD_CLOUD") {
    const maxWords = slide.config?.maxWords ?? 3;
    return <WordCloudInput maxWords={maxWords} onSubmit={onSubmit} />;
  }

  // OPEN_ENDED
  return <TextInput onSubmit={onSubmit} />;
}

function WordCloudInput({ maxWords, onSubmit }: { maxWords: number; onSubmit: (v: unknown) => void }) {
  const [words, setWords] = useState<string[]>(Array(maxWords).fill(""));
  return (
    <form
      className="w-full max-w-sm flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(words.filter((w) => w.trim()));
      }}
    >
      {words.map((w, i) => (
        <input
          key={i}
          className="border-2 border-gray-200 bg-white text-gray-900 placeholder-gray-300 rounded-xl px-4 py-2.5 text-center text-base font-medium focus:border-brand focus:outline-none transition"
          placeholder={`Word ${i + 1}`}
          value={w}
          onChange={(e) => {
            const next = [...words];
            next[i] = e.target.value;
            setWords(next);
          }}
        />
      ))}
      <button
        type="submit"
        className="bg-brand text-white rounded-xl py-3 font-bold text-base hover:bg-brand-dark active:scale-95 transition shadow-lg shadow-brand/20"
      >
        Submit
      </button>
    </form>
  );
}

function TextInput({ onSubmit }: { onSubmit: (v: unknown) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="w-full max-w-sm flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
    >
      <textarea
        className="border-2 border-gray-200 bg-white text-gray-900 placeholder-gray-300 rounded-xl px-4 py-3 min-h-[90px] text-base focus:border-brand focus:outline-none transition"
        placeholder="Type your answer..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="submit"
        className="bg-brand text-white rounded-xl py-3 font-bold text-base hover:bg-brand-dark active:scale-95 transition shadow-lg shadow-brand/20"
      >
        Submit
      </button>
    </form>
  );
}
