import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { getSocket } from "../lib/socket";
import { getToken } from "../lib/api";
import { API_BASE } from "../lib/config";
import ResultsView from "../components/ResultsView";
import { Podium, LeaderboardList, type LeaderboardEntry } from "../components/Podium";

interface CurrentSlide {
  id: string;
  type: string;
  question: string;
  config: any;
  order: number;
}

export default function Present() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [status, setStatus] = useState<"LOBBY" | "ACTIVE" | "ENDED">("LOBBY");
  const [index, setIndex] = useState(-1);
  const [totalSlides, setTotalSlides] = useState(0);
  const [currentSlide, setCurrentSlide] = useState<CurrentSlide | null>(null);
  const [aggregate, setAggregate] = useState<any>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  // "leaderboard" is an ephemeral interstitial view, not a real slide — it's
  // automatically inserted after a quiz question before the next real slide.
  const [viewMode, setViewMode] = useState<"question" | "leaderboard">("question");
  const [finalEntries, setFinalEntries] = useState<LeaderboardEntry[] | null>(null);
  const joinCodeRef = useRef<string | null>(null);
  const currentSlideIdRef = useRef<string | null>(null);
  // React StrictMode double-invokes effects in dev; without this guard we'd
  // silently create two live sessions (and two join codes) per page load.
  const sessionCreatedRef = useRef(false);

  useEffect(() => {
    const socket = getSocket();

    if (!sessionCreatedRef.current) {
      sessionCreatedRef.current = true;
      socket.emit(
        "presenter:create-session",
        { token: getToken(), presentationId: id },
        (res: any) => {
          if (res?.error) {
            setError(res.error);
            return;
          }
          setJoinCode(res.joinCode);
          joinCodeRef.current = res.joinCode;
          setSessionId(res.sessionId);
          setStatus(res.status);
          setIndex(res.currentIndex);
          setTotalSlides(res.totalSlides);
          setCurrentSlide(res.currentSlide);
          currentSlideIdRef.current = res.currentSlide?.id ?? null;
        }
      );
    }

    socket.on("slide:changed", (payload) => {
      setIndex(payload.index);
      setStatus(payload.status);
      setCurrentSlide(payload.currentSlide);
      currentSlideIdRef.current = payload.currentSlide?.id ?? null;
      setTotalSlides(payload.totalSlides);
      setAggregate(null);
      setViewMode("question");
    });

    socket.on("results:updated", (payload) => {
      // Ignore results for a slide we've already navigated away from —
      // a late-arriving broadcast shouldn't flash stale data on screen.
      if (payload.slideId === currentSlideIdRef.current) {
        setAggregate(payload.aggregate);
      }
    });

    socket.on("participant:count", (payload) => {
      setParticipantCount(payload.count);
    });

    socket.on("leaderboard:updated", (payload) => {
      setLeaderboard(payload.entries ?? []);
    });

    return () => {
      socket.off("slide:changed");
      socket.off("results:updated");
      socket.off("participant:count");
      socket.off("leaderboard:updated");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isCurrentQuiz = currentSlide?.type === "MULTIPLE_CHOICE" && !!currentSlide.config?.isQuiz;

  // The leaderboard is a shared "big screen" moment — showing/hiding it emits
  // a socket event so participants' phones flip to it in sync, not just the
  // presenter's own screen.
  function showLeaderboard() {
    setViewMode("leaderboard");
    getSocket().emit("presenter:show-leaderboard", { joinCode: joinCodeRef.current, token: getToken() }, () => {});
  }
  function hideLeaderboard() {
    setViewMode("question");
    getSocket().emit("presenter:hide-leaderboard", { joinCode: joinCodeRef.current, token: getToken() }, () => {});
  }

  function next() {
    // First "Next" press after a quiz question shows the leaderboard instead
    // of advancing — matches Kahoot/Menti's quiz flow. Press again to move on.
    if (isCurrentQuiz && viewMode === "question") {
      showLeaderboard();
      return;
    }
    setViewMode("question");
    getSocket().emit("presenter:next", { joinCode: joinCodeRef.current, token: getToken() }, () => {});
  }
  function prev() {
    if (viewMode === "leaderboard") {
      hideLeaderboard();
      return;
    }
    getSocket().emit("presenter:prev", { joinCode: joinCodeRef.current, token: getToken() }, () => {});
  }
  function start() {
    getSocket().emit("presenter:goto", { joinCode: joinCodeRef.current, index: 0, token: getToken() }, () => {});
  }
  function endSession() {
    getSocket().emit("presenter:end", { joinCode: joinCodeRef.current, token: getToken() }, (res: any) => {
      setFinalEntries(res?.entries ?? []);
    });
  }

  async function exportCsv() {
    if (!sessionId) return;
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/export`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${joinCode}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // With HashRouter the app is always served from "/", so the join link is
  // "<origin><pathname>#/join/<code>" — building it from location.href's
  // existing hash-free prefix keeps this correct under a GitHub Pages
  // project subpath (e.g. https://user.github.io/repo/) too.
  const joinUrl = joinCode
    ? `${window.location.origin}${window.location.pathname}#/join/${joinCode}`
    : "";
  const nextDisabled =
    viewMode === "question" && isCurrentQuiz ? false : index >= totalSlides - 1;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-rose-500 font-semibold text-lg">{error}</p>
      </div>
    );
  }

  if (finalEntries) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 bg-white">
        <p className="text-4xl font-black text-gray-900">🏆 Final Results</p>
        {finalEntries.length > 0 ? (
          <>
            <Podium entries={finalEntries} />
            <div className="w-full max-w-md mt-2">
              <LeaderboardList entries={finalEntries} />
            </div>
          </>
        ) : (
          <p className="text-gray-400">No quiz scores in this session.</p>
        )}
        <button
          onClick={() => navigate("/dashboard")}
          className="mt-4 bg-brand text-white px-8 py-3 rounded-full font-bold hover:bg-brand-dark active:scale-95 transition shadow-lg shadow-brand/20"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900">
      <header className="flex justify-between items-center px-6 py-3 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-500 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          {participantCount} joined
        </p>
        <p className="text-sm font-medium text-gray-500">
          {index >= 0 ? `Slide ${index + 1} / ${totalSlides}` : "Lobby"}
        </p>
        <div className="flex gap-4 items-center">
          {leaderboard.length > 0 && (
            <button
              onClick={() => (viewMode === "leaderboard" ? hideLeaderboard() : showLeaderboard())}
              className="text-gray-500 text-sm hover:text-brand transition"
            >
              🏆 Leaderboard
            </button>
          )}
          <button onClick={exportCsv} className="text-gray-500 text-sm hover:text-brand transition">
            Export CSV
          </button>
          <button onClick={endSession} className="text-rose-500 text-sm hover:text-rose-600 transition">
            End session
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-8 py-8 gap-6">
        {status === "LOBBY" ? (
          <div className="flex flex-col items-center gap-5 animate-slide-up">
            <p className="text-gray-500 text-lg">Join at</p>
            <p className="text-3xl font-bold text-gray-900">
              {window.location.host}
              {window.location.pathname}#/join
            </p>
            <p className="text-7xl font-black tracking-widest text-brand">{joinCode}</p>
            {joinUrl && (
              <div className="bg-white p-4 rounded-2xl shadow-xl border border-gray-100">
                <QRCodeSVG value={joinUrl} size={200} />
              </div>
            )}
            <button
              onClick={start}
              disabled={totalSlides === 0}
              className="mt-4 bg-brand text-white px-10 py-4 rounded-full font-bold text-lg hover:bg-brand-dark active:scale-95 transition disabled:opacity-40 shadow-lg shadow-brand/20"
            >
              Start presentation 🚀
            </button>
          </div>
        ) : viewMode === "leaderboard" ? (
          <div className="w-full max-w-md flex flex-col items-center gap-6 animate-slide-up">
            <p className="text-3xl font-extrabold text-gray-900">🏆 Leaderboard</p>
            {leaderboard.length >= 3 && <Podium entries={leaderboard.slice(0, 3)} />}
            <LeaderboardList entries={leaderboard} />
          </div>
        ) : (
          <div key={currentSlide?.id} className="w-full max-w-2xl flex flex-col items-center gap-6 animate-slide-up">
            <p className="text-4xl font-extrabold text-center text-gray-900">{currentSlide?.question}</p>
            {isCurrentQuiz && (
              <p className="text-sm text-gray-500 -mt-4">
                🏆 Quiz question &middot; {currentSlide?.config.timeLimitSec ?? 20}s &middot; correct answer
                highlighted below
              </p>
            )}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6 w-full shadow-sm">
              <ResultsView
                aggregate={aggregate}
                correctIndex={isCurrentQuiz ? currentSlide?.config.correctIndex : undefined}
              />
            </div>
          </div>
        )}
      </main>

      <footer className="flex justify-center gap-4 py-4 border-t border-gray-100">
        <button
          onClick={prev}
          disabled={index <= 0 && viewMode === "question"}
          className="px-5 py-2.5 rounded-full bg-gray-100 hover:bg-gray-200 transition disabled:opacity-30 font-medium text-gray-700"
        >
          ← Prev
        </button>
        <button
          onClick={next}
          disabled={nextDisabled}
          className="px-5 py-2.5 rounded-full bg-brand text-white hover:bg-brand-dark active:scale-95 transition disabled:opacity-30 font-medium"
        >
          {isCurrentQuiz && viewMode === "question" ? "View Leaderboard 🏆" : "Next →"}
        </button>
      </footer>
    </div>
  );
}
