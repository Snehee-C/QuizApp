import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  getAvatarIndex,
  getNickname,
  getParticipantId,
  getSocket,
  setNickname,
} from "../lib/socket";
import { avatarFor } from "../lib/avatars";
import { TILE_COLORS, ballBg } from "../lib/palette";
import { spring } from "../lib/motion";
import { Podium, type LeaderboardEntry } from "../components/Podium";
import { BarRaceLeaderboard } from "../components/BarRaceLeaderboard";
import { PlayerBubbles } from "../components/PlayerBubbles";
import { NumberTicker } from "../components/ui/NumberTicker";
import { TimerRing } from "../components/ui/TimerRing";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Card";
import { slideType } from "../slides/registry";
import { QaPanel } from "../components/qa/QaPanel";
import { ReactionBar } from "../components/reactions/ReactionBar";
import { ConnectionBanner } from "../components/ConnectionBanner";
// Aliased: `setCurrentSlide` is already this component's React state setter.
import {
  flushQueue,
  setCurrentSlide as setRetryQueueSlide,
  submitWithRetry,
} from "../lib/connection";
import { initSound, playSound, unlockAudio } from "../lib/sound";
import { burstFrom } from "../lib/confetti";
import { cn } from "../lib/cn";

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

interface Reveal {
  /** The whole `slide:reveal` payload — its shape is the slide module's business. */
  raw: Record<string, any>;
  aggregate: any;
}

interface LobbyParticipant {
  participantId: string;
  name: string;
  avatar: number;
}

// The player's phone is always Stage Dark — it's held 40cm from the face in a
// room that is usually dim, and a white screen in a dark auditorium is hostile
// (DESIGN.md §5). The canvas colour comes from the token layer, so this is only
// the atmospheric wash that sits on top of it.
const PHONE_SHELL =
  "h-[100dvh] w-full flex flex-col bg-canvas text-ink overflow-hidden";

// The player's seat in a room, persisted across reloads.
//
// `joined` used to be plain component state, so reloading a phone mid-question
// dumped the player back on the nickname form while the clock ran down and the
// presenter's count dropped (B4). The nickname and the participant id already
// survive in localStorage; the only fact missing was "this player is already
// in THIS room", which is all of what is stored here.
//
// Scoped to the join code so a different room still asks, and stamped with a
// time so a link opened the next day asks again rather than silently seating
// someone in a session they never agreed to join.
const SEAT_KEY = "menti_seat";
const SEAT_TTL_MS = 12 * 60 * 60 * 1000;

function hasSeat(code: string | undefined): boolean {
  if (!code) return false;
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    if (!raw) return false;
    const seat = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const at = typeof seat.at === "number" ? seat.at : 0;
    return seat.code === code && Date.now() - at < SEAT_TTL_MS;
  } catch {
    // A corrupt or unreadable entry means "no seat" — never a thrown render.
    return false;
  }
}

function takeSeat(code: string | undefined): void {
  if (!code) return;
  try {
    localStorage.setItem(SEAT_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // Private-mode quota failures cost us the reload resume, nothing more.
  }
}

function leaveSeat(): void {
  try {
    localStorage.removeItem(SEAT_KEY);
  } catch {
    /* see takeSeat */
  }
}

// A single soft accent bloom, on the canvas layer only — a gradient is a room,
// not a decoration (DESIGN.md P2).
function Bloom() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background:
          "radial-gradient(760px 420px at 50% -12%, var(--accent-a18) 0%, transparent 62%)",
      }}
    />
  );
}

export default function Play() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const participantId = useRef(getParticipantId());
  const [name, setName] = useState(getNickname());
  // Restored from the persisted seat, so a reload re-enters the room instead
  // of rendering the join gate over a live question (B4). A seat without a
  // nickname is not enough — we would re-join as "Anonymous".
  const [joined, setJoined] = useState(() => !!getNickname() && hasSeat(code));
  const [status, setStatus] = useState<"LOBBY" | "ACTIVE" | "ENDED">("LOBBY");
  const [currentSlide, setCurrentSlide] = useState<CurrentSlide | null>(null);
  // Mirrors currentSlide for socket handlers, which close over the state of
  // the render that registered them.
  const currentSlideRef = useRef<CurrentSlide | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Server-authoritative countdown, already scaled for relaxed timing.
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<SubmitFeedback | null>(null);
  const [ended, setEnded] = useState(false);
  const [finalEntries, setFinalEntries] = useState<LeaderboardEntry[]>([]);
  // Set only while the presenter has the leaderboard "on screen" — mirrors
  // the big-screen moment onto every phone at the same instant.
  const [leaderboardView, setLeaderboardView] = useState<LeaderboardEntry[] | null>(null);
  // The presenter revealed the answer for this slide. Input locks; correct
  // option(s) light up.
  const [reveal, setReveal] = useState<Reveal | null>(null);
  // The server already holds a graded response from this participant for the
  // current slide. Set from the join ack, so a phone that reconnects or
  // reloads after answering comes back locked instead of showing a fresh,
  // tappable question — `participant:submit` upserts, so one stray tap used to
  // overwrite an already-scored answer with a 0 (M7).
  const [answered, setAnswered] = useState(false);
  // What they sent, echoed back by the ack, so the lock can show *their* pick
  // rather than an anonymous "you already answered".
  const [myAnswer, setMyAnswer] = useState<unknown>(null);
  // A rejected submit. A line, never a screen: the question is still on it.
  const [submitError, setSubmitError] = useState("");
  const [participants, setParticipants] = useState<LobbyParticipant[]>([]);
  // Self-paced decks let each player move themselves; the server replies only
  // to this socket so nobody else's screen changes.
  const [pacing, setPacing] = useState<"PRESENTER" | "AUDIENCE">("PRESENTER");
  const [index, setIndex] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);
  // A phone-sized bottom sheet: answering, asking questions, or reacting.
  const [tab, setTab] = useState<"answer" | "qa">("answer");
  // The self-paced clock has run out. Measured: at that point the server stops
  // awarding the speed half and the question stays open and answerable.
  const [speedExpired, setSpeedExpired] = useState(false);
  // What this player has already submitted, by slide id.
  //
  // Only self-paced decks can revisit a slide, and only this tab can answer
  // "did I already answer that one" for a slide other than the current — the
  // join ack reports it for the slide you land on, and the `participant:goto`
  // ack does not report it at all. A ref rather than state: nothing renders
  // from it directly, it is read at the moment of a navigation.
  const answeredSlides = useRef<Map<string, { value: unknown; feedback: SubmitFeedback }>>(new Map());
  /** Reveals this player has already seen, by slide id. Same reason as above. */
  const revealedSlides = useRef<Map<string, Reveal>>(new Map());

  // `pacing` is read inside socket handlers but must NOT be an effect
  // dependency: the join ack sets it, so depending on it tore the whole
  // subscription down and re-emitted `participant:join`, which broadcast a
  // redundant participant:count to every phone in the room.
  const pacingRef = useRef<"PRESENTER" | "AUDIENCE">("PRESENTER");

  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    // Runs for the first join AND for every reconnect re-join — the ack is
    // specified to be correct for both, so one handler serves both.
    const applyJoinAck = (res: any, isRejoin: boolean) => {
      if (res?.error) {
        // Drop the seat: a stale one would otherwise brick this phone on the
        // dead-end error screen on every single reload.
        leaveSeat();
        // The server refuses a join into a finished deck. On a *re*-join that
        // is an ending, not a failure — a phone that blips after the podium
        // would otherwise have it replaced by "Try another code".
        //
        // Keyed off the stable `code` (wire contract §2), not the copy: this
        // branch is the difference between the results screen and a dead end,
        // and keying it to the exact string "Session has ended" meant any
        // reword silently demoted it. The literal is kept ONLY as a fallback
        // for a server that predates `code`, and is consulted only when the
        // ack carries none — a code that is present is authoritative.
        if (res.code ? res.code === "SESSION_ENDED" : res.error === "Session has ended") {
          setEnded(true);
          return;
        }
        setError(res.error);
        return;
      }
      setError("");
      setStatus(res.status);
      setTotalSlides(res.totalSlides ?? 0);
      const nextPacing = res.pacing === "AUDIENCE" ? "AUDIENCE" : "PRESENTER";
      pacingRef.current = nextPacing;
      setPacing(nextPacing);

      // Gap 3: standings used to be a pure broadcast (`leaderboard:show`) with
      // no state behind it, so a phone that reloaded while the host had them
      // on the projector came back rendering the slide — dropping out of a
      // shared scoreboard moment the whole room was looking at. The ack now
      // carries the live view in the same `{ entries }` shape the broadcast
      // does (wire contract §3), so one unwrapping serves both.
      //
      // Ahead of the audience-pacing early return below, and applied on a
      // FIRST join as well as a re-join, both deliberately. The broadcast goes
      // to the whole room irrespective of pacing, so restoring it must not
      // depend on pacing either — and a reload, which is the case QA actually
      // measured, is a first join as far as this component is concerned.
      //
      // `undefined` means a server that predates the field: leave whatever is
      // on screen rather than blanking a leaderboard we were legitimately shown.
      if (res.leaderboardView !== undefined) {
        setLeaderboardView(res.leaderboardView ? (res.leaderboardView.entries ?? []) : null);
      }

      // The same audience-pacing contract `onSlideChanged` enforces: a
      // self-paced player who already has a slide owns their own position and
      // must not be hauled to the host's by a reconnect. A player with no
      // slide yet has nothing to be dragged away FROM and must still be seated.
      if (isRejoin && nextPacing === "AUDIENCE" && currentSlideRef.current) {
        flushQueue();
        return;
      }

      const sameSlide =
        !!res.currentSlide?.id && currentSlideRef.current?.id === res.currentSlide.id;
      setCurrentSlide(res.currentSlide);
      // Someone joining mid-session already has a slide; the ref has to know
      // that, or the next host slide change would re-seat them.
      currentSlideRef.current = res.currentSlide ?? null;
      setStartedAt(res.startedAt ?? null);
      // Server-authoritative and already scaled for relaxed timing — never
      // re-derived from slide.config, or the ring and the server's auto-reveal
      // disagree for anyone using that accessibility setting.
      setTimeLimit(res.timeLimitSec ?? null);
      setIndex(res.index ?? 0);

      // M6: the ack carries the current slide's reveal state. Without it a
      // reconnecting phone rendered a live question with a running clock on a
      // slide that had already closed — every submit bounced with "Time's up",
      // so tapping an answer did visibly nothing.
      const payload =
        res.reveal && res.reveal.slideId === res.currentSlide?.id ? res.reveal : null;
      setReveal(
        res.revealed && res.currentSlide
          ? { raw: payload ?? { slideId: res.currentSlide.id }, aggregate: payload?.aggregate }
          : null
      );

      // M7: lock on the server's record, not on what this tab remembers.
      setAnswered(!!res.answered);
      setMyAnswer(res.answered ? (res.myAnswer ?? null) : null);
      // Keep any feedback we already earned on this very slide — the ack has
      // no points or rank, so clearing it would downgrade "Correct +992" to a
      // bare lock. On any other slide it is stale and must go.
      if (!sameSlide) setFeedback(null);
      setSubmitError("");
      // Release anything the outage left queued, but only when we came back to
      // the slide it belongs to. `setRetryQueueSlide` does not run until the
      // re-render below, so flushing after a slide change here would re-send
      // an answer into a question the room has already left.
      if (sameSlide) flushQueue();
    };

    const emitJoin = (isRejoin: boolean) => {
      socket.emit(
        "participant:join",
        {
          joinCode: code,
          participantId: participantId.current,
          name,
          avatar: getAvatarIndex(),
        },
        (res: any) => applyJoinAck(res, isRejoin)
      );
    };

    emitJoin(false);

    // B3: without this a Wi-Fi blip is permanent. Socket.IO reconnects the
    // same client object under a NEW socket id, and the old one's room
    // membership and `socket.data.{role,participantId,joinCode}` die with it —
    // so the phone receives no `slide:changed`, no `slide:reveal` and no
    // `session:ended`, and every answer it sends is rejected. Re-emitting the
    // (idempotent) join is the entire repair; `flushQueue` in the ack then
    // releases anything the outage left queued.
    //
    // Socket.IO buffers an emit made while disconnected and ships it on the
    // next connect, so if we are not connected yet that first `connect` is
    // carrying our initial join already — re-joining on it would duplicate the
    // join and broadcast a redundant `participant:count` to the whole room.
    let initialJoinPending = !socket.connected;
    const onConnect = () => {
      if (initialJoinPending) {
        initialJoinPending = false;
        return;
      }
      emitJoin(true);
    };
    socket.on("connect", onConnect);

    const onSlideChanged = (payload: any) => {
      setStatus(payload.status);
      setTotalSlides(payload.totalSlides ?? 0);

      // In a self-paced deck the host's navigation must not drag everyone
      // along — that is the contract of audience pacing. But a player who has
      // NO slide yet has nothing to be dragged away FROM: that event is the
      // session starting, and they have to be seated on its slide. Skipping it
      // unconditionally stranded them on the lobby forever, because the guard
      // below renders the lobby whenever there is no slide, and the buttons
      // that would let them move only exist in the in-session view.
      const selfPaced = pacingRef.current === "AUDIENCE";
      if (selfPaced && currentSlideRef.current && payload.status === "ACTIVE") return;

      setCurrentSlide(payload.currentSlide);
      currentSlideRef.current = payload.currentSlide ?? null;
      // The clock, in BOTH pacings now.
      //
      // This used to null both for self-paced decks, on the reasoning that a
      // self-paced slide has no shared clock. The premise was true and is not
      // any more: when the host navigates, the server marks every player
      // present as having arrived at that instant, and scores them from it.
      // So there IS a clock here — this is the one slide in an audience-paced
      // deck where everyone's happens to start together.
      //
      // Nulling it did not mean "no ring", either. It meant the ring fell
      // through to `currentSlide.config.timeLimitSec`, the raw authored value,
      // so a relaxed-timing deck showed a 20s countdown over a 30s window. The
      // server's broadcast says exactly this, and it is right: the client must
      // not re-derive a countdown from config, or the ring and the auto-reveal
      // disagree about when the answer closed.
      setStartedAt(payload.startedAt ?? null);
      setTimeLimit(payload.timeLimitSec ?? null);
      setIndex(payload.index ?? 0);
      setFeedback(null);
      setLeaderboardView(null);
      setReveal(null);
      // A new slide is a new answer: the M7 lock is per-slide, not per-session.
      setAnswered(false);
      setMyAnswer(null);
      setSubmitError("");
    };

    const onReveal = (payload: any) => {
      setCurrentSlide((slide) => {
        if (slide && payload.slideId === slide.id) {
          const next = { raw: payload ?? {}, aggregate: payload?.aggregate };
          setReveal(next);
          // Kept for the self-paced walk-back, same reason as the answer: the
          // `participant:goto` ack carries no reveal, so a revisited slide
          // would otherwise say "answer coming up" about an answer this player
          // already watched arrive.
          revealedSlides.current.set(payload.slideId, next);
          playSound("reveal");
        }
        return slide;
      });
    };

    const onCount = (payload: any) => setParticipants(payload?.participants ?? []);
    const onLeaderboardShow = (payload: any) => setLeaderboardView(payload.entries ?? []);
    const onLeaderboardHide = () => setLeaderboardView(null);
    const onEnded = (payload: any) => {
      setEnded(true);
      setFinalEntries(payload?.entries ?? []);
    };

    socket.on("slide:changed", onSlideChanged);
    socket.on("slide:reveal", onReveal);
    socket.on("participant:count", onCount);
    socket.on("leaderboard:show", onLeaderboardShow);
    socket.on("leaderboard:hide", onLeaderboardHide);
    socket.on("session:ended", onEnded);

    return () => {
      // Remove THESE handlers, not every listener for the event. The socket is
      // a module-level singleton shared with the Q&A and reaction components,
      // so a bare `socket.off(event)` would unsubscribe them too — and
      // `connect` in particular also carries the retry queue's own flush.
      socket.off("connect", onConnect);
      socket.off("slide:changed", onSlideChanged);
      socket.off("slide:reveal", onReveal);
      socket.off("participant:count", onCount);
      socket.off("leaderboard:show", onLeaderboardShow);
      socket.off("leaderboard:hide", onLeaderboardHide);
      socket.off("session:ended", onEnded);
    };
  }, [code, joined, name]);

  // Self-navigation. Only this socket is updated, by design.
  function goto(next: number) {
    getSocket().emit(
      "participant:goto",
      { joinCode: code, participantId: participantId.current, index: next },
      (res: any) => {
        if (res?.error) return;
        setCurrentSlide(res.currentSlide);
        currentSlideRef.current = res.currentSlide ?? null;
        setIndex(res.index);
        setTotalSlides(res.totalSlides);
        // Both halves of the clock, from the server, together.
        //
        // `startedAt` was already being read and `timeLimitSec` was not, so the
        // ring fell through to `currentSlide.config.timeLimitSec` — the RAW
        // authored value. The server's number is the same one scaled by the
        // deck's `timeScale`, which is the relaxed-timing accessibility
        // setting. So on exactly the decks that turn it on, the ring counted
        // down a window the server was not using: at ×1.5 it hit zero a third
        // of the way before the answer actually closed.
        //
        // A clock that lies is worse than no clock, and it lied hardest to the
        // players the setting exists for. Null when the slide is not timed,
        // which is also the server's answer and must not be read as "fall back
        // to the config".
        setStartedAt(res.startedAt ?? null);
        setTimeLimit(res.timeLimitSec ?? null);
        setSubmitError("");
        setTab("answer");

        // Walking back to a question you have already answered must not hand
        // you a fresh one.
        //
        // This cleared `answered`/`myAnswer` unconditionally, so stepping back
        // in a self-paced deck re-armed four tappable tiles over an answer the
        // server had already scored — and `participant:submit` UPSERTS, so one
        // tap replaced a 927-point answer with a late, cheap one. It was always
        // wrong and it was always silent; the countdown that now renders here
        // turned it into an active invitation to do it, which is how it
        // surfaced at all.
        const prior = res.currentSlide?.id
          ? answeredSlides.current.get(res.currentSlide.id)
          : undefined;
        setAnswered(!!prior);
        setMyAnswer(prior ? prior.value : null);
        // Their own result, as they last saw it — the server does not re-send
        // it, and a locked slide with no explanation reads as a broken one.
        setFeedback(prior ? prior.feedback : null);
        // And the reveal, if this player already watched it land. The
        // distribution in it is as of the moment they saw it rather than now —
        // the server sends no fresh one here — but a slightly stale tally is a
        // far smaller error than telling someone the answer is still coming to
        // a question they have already seen answered.
        setReveal(res.currentSlide?.id ? (revealedSlides.current.get(res.currentSlide.id) ?? null) : null);
      }
    );
  }

  useEffect(() => {
    initSound({ role: "participant" });
  }, []);

  // When a self-paced countdown reaches zero, say what that actually meant.
  //
  // The same ring renders in both pacings and means two different things. With
  // a host driving, zero is a deadline: the server auto-reveals and the
  // question closes. In AUDIENCE pacing it never does — that is a server
  // GUARANTEE, not an observed quirk: `armRevealTimer` returns early for
  // self-paced decks, because a reveal is one room-wide frame and a deck where
  // everyone is on a different slide has no shared moment to fire it at. (It
  // used to fire anyway, landing on whoever was still reading and closing the
  // question against them.) So the tiles stay live, and a correct answer still
  // scores MIN_POINTS.
  //
  // Which makes the ring a speed meter wearing a deadline's clothes: it would
  // spend its last three seconds pulsing rose about a consequence that never
  // arrives. Keyed on PACING rather than on how the player reached the slide —
  // the deck's mode is what decides whether zero closes anything, so the slide
  // the host seated everyone on is no different from one they walked to.
  //
  // One timeout armed for the exact moment rather than a poll, and the ring is
  // retired at the same instant: a clock frozen at zero is a broken clock,
  // while a line saying what zero cost is an answer.
  useEffect(() => {
    setSpeedExpired(false);
    if (pacing !== "AUDIENCE" || startedAt === null || !timeLimit) return;
    const left = startedAt + timeLimit * 1000 - Date.now();
    if (left <= 0) {
      setSpeedExpired(true);
      return;
    }
    const t = window.setTimeout(() => setSpeedExpired(true), left);
    return () => window.clearTimeout(t);
  }, [pacing, startedAt, timeLimit, currentSlide?.id]);

  // Tell the retry queue which slide is live, so an answer queued during an
  // outage is abandoned rather than replayed into a finished question.
  useEffect(() => {
    setRetryQueueSlide(currentSlide?.id ?? null);
  }, [currentSlide?.id]);

  function submit(value: unknown) {
    // `answered` is the reconnect lock (M7). The server upserts responses, so
    // without it one stray tap on a resumed phone rewrites an already-scored
    // answer as a fresh, late, zero-point one.
    if (!currentSlide || reveal || answered) return;
    setSubmitError("");
    // Queued and retried if the socket is down — venue Wi-Fi drops constantly,
    // and a silently lost answer is the worst possible failure for a player.
    submitWithRetry(
      getSocket(),
      "participant:submit",
      {
        joinCode: code,
        slideId: currentSlide.id,
        participantId: participantId.current,
        value,
      },
      { slideKey: currentSlide.id }
    ).then((res: any) => {
      // Abandoned before it ever reached the server — the slide moved on, or
      // the player tapped a different answer for this same slide.
      if (!res) return;
      if (res.error) {
        // Never swallowed. A rejected answer that produces no visible change
        // is indistinguishable from a dead screen, and the player has no way
        // to know their answer is not counting. The strip is suppressed once
        // the reveal lands — by then the reveal itself is the explanation.
        setSubmitError(res.error);
        return;
      }
      setFeedback(res);
      setAnswered(true);
      setMyAnswer(value);
      // Keep it. In a self-paced deck the player can walk back here, and the
      // server's `participant:goto` ack does not carry `answered`/`myAnswer`
      // the way the join ack does — so this tab is the only thing that knows.
      answeredSlides.current.set(currentSlide.id, { value, feedback: res });
      if (res.isQuiz) playSound(res.correct ? "correct" : "wrong");
    });
  }

  if (!joined) {
    return (
      <NicknameGate
        initialName={name}
        onJoin={(n) => {
          setNickname(n);
          setName(n);
          // Persisted before the emit: the seat is what makes a reload land
          // back in the room instead of here (B4).
          takeSeat(code);
          setJoined(true);
        }}
      />
    );
  }

  // Ahead of the error gate on purpose: a game that finished is a result, and
  // a late connection error must never overwrite the podium with a dead end.
  if (ended) {
    const mine = finalEntries.find((e) => e.participantId === participantId.current);
    const myRank = mine ? finalEntries.indexOf(mine) + 1 : null;
    return (
      <SessionEnded
        entries={finalEntries}
        mine={mine}
        myRank={myRank}
        onLeave={() => {
          // The seat is what makes a reload land back in the room (B4). This
          // room is over, so holding the seat would send them straight back to
          // this podium on the next load — a game they already finished.
          leaveSeat();
          navigate("/join");
        }}
      />
    );
  }

  if (error) {
    return (
      <div className={cn(PHONE_SHELL, "items-center justify-center gap-5 px-6 text-center")}>
        <Bloom />
        <p className="relative z-10 text-title2 font-display font-bold">{error}</p>
        <Button
          variant="secondary"
          size="lg"
          className="relative z-10"
          onClick={() => {
            leaveSeat();
            navigate("/join");
          }}
        >
          Try another code
        </Button>
      </div>
    );
  }

  if (leaderboardView) {
    return (
      <PlayerLeaderboard entries={leaderboardView} meId={participantId.current} />
    );
  }

  if (status === "LOBBY" || !currentSlide) {
    return <Lobby name={name} code={code ?? ""} participants={participants} />;
  }

  const isQuiz = currentSlide.type === "MULTIPLE_CHOICE" && currentSlide.config?.isQuiz;
  // A countdown is an invitation to answer. Anyone already locked in — this
  // round or before a reconnect — must not be watching one tick down.
  const showTimer = isQuiz && !feedback && !reveal && !answered && !speedExpired;

  return (
    <div className={PHONE_SHELL}>
      <Bloom />

      {/* The phone is a control deck, so the question is a compact header, not
       * the hero — attention belongs on the shared screen. It stays present
       * (rather than being dropped entirely) because remote players often have
       * no shared screen at all. */}
      <header className="relative z-10 shrink-0 px-5 pt-5 pb-3 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          {/* "Three of twelve." Status, not mirrored content — DESIGN.md
              rejects echoing the big screen onto the phone, and this echoes
              nothing: it answers "how much of this is left", which the shared
              screen never says and a remote player with no shared screen
              cannot possibly know.

              Host-paced only. A self-paced deck already carries the same
              counter in its own nav bar at the foot of the screen, and two
              spellings of one fact is the defect P1 exists to prevent. */}
          {pacing === "PRESENTER" && totalSlides > 0 && (
            <p className="nums text-caption2 font-semibold uppercase track-label text-ink-subtle mb-1">
              {index + 1} of {totalSlides}
            </p>
          )}
          <p className="font-display font-bold text-body leading-snug text-ink-muted line-clamp-3">
            {currentSlide.question}
          </p>
          {speedExpired && isQuiz && !feedback && !reveal && !answered && (
            <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle mt-1.5">
              Speed bonus used up — your answer still counts
            </p>
          )}
        </div>
        {showTimer && (
          <TimerRing
            key={currentSlide.id}
            startedAt={startedAt}
            timeLimitSec={timeLimit ?? currentSlide.config.timeLimitSec ?? 20}
            size={56}
            stroke={6}
            className="shrink-0"
          />
        )}
      </header>

      <div className="relative z-10 flex-1 min-h-0 flex flex-col justify-center px-4 pb-2 overflow-y-auto">
        {tab === "qa" ? (
          <QaPanel joinCode={code ?? ""} participantId={participantId.current} name={name} />
        ) : (
          <AnimatePresence mode="wait">
            {reveal ? (
              <RevealCard
                key="reveal"
                slide={currentSlide}
                reveal={reveal}
                feedback={feedback}
                answered={answered}
              />
            ) : feedback ? (
              <FeedbackCard key="feedback" feedback={feedback} />
            ) : answered ? (
              // Resumed onto a slide the server already has our answer for.
              // Deliberately ahead of AnswerInput: a tappable question here is
              // the whole of M7.
              <AlreadyAnsweredCard
                key="answered"
                slide={currentSlide}
                isQuiz={isQuiz}
                myAnswer={myAnswer}
              />
            ) : (
              <AnswerInput key={currentSlide.id} slide={currentSlide} onSubmit={submit} />
            )}
          </AnimatePresence>
        )}
      </div>

      {/* Self-paced decks give the player their own navigation; presenter-paced
          ones deliberately do not, so nobody can run ahead of the room. */}
      {pacing === "AUDIENCE" && tab === "answer" && (
        <div className="relative z-10 shrink-0 flex items-center justify-between gap-3 px-4 pb-2">
          <Button variant="secondary" size="md" disabled={index <= 0} onClick={() => goto(index - 1)}>
            ← Back
          </Button>
          <span className="nums text-footnote text-ink-subtle">
            {index + 1} / {totalSlides}
          </span>
          <Button
            variant="secondary"
            size="md"
            disabled={index >= totalSlides - 1}
            onClick={() => goto(index + 1)}
          >
            Next →
          </Button>
        </div>
      )}

      <footer className="relative z-10 shrink-0 px-4 pb-4 pt-1 flex flex-col gap-2">
        {/* The server's own words for why the answer did not count. Suppressed
            once the reveal is up: the reveal already says the window closed,
            and "Time's up" twice reads as a fault rather than a result. */}
        {submitError && !reveal && (
          <p role="alert" className="text-footnote text-warn text-center leading-tight">
            {submitError}
          </p>
        )}
        <ConnectionBanner />
        <ReactionBar joinCode={code ?? ""} />
        <div className="flex gap-1.5" role="tablist" aria-label="Phone view">
          {(
            [
              ["answer", "Answer"],
              ["qa", "Ask a question"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "flex-1 h-11 rounded-md text-subhead font-semibold transition-colors duration-fast",
                tab === key ? "bg-surface-2 text-ink shadow-line" : "text-ink-subtle hover:text-ink"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

function NicknameGate({
  initialName,
  onJoin,
}: {
  initialName: string;
  onJoin: (name: string) => void;
}) {
  const [value, setValue] = useState(initialName);
  const av = avatarFor(getAvatarIndex());
  // `.bubble` — this disc floats alone on the phone's dark canvas, so it
  // needs separation from the CANVAS, not from the other slots (answers.ts).
  const solid = TILE_COLORS[av.tile % TILE_COLORS.length].bubble;

  return (
    <div className={cn(PHONE_SHELL, "items-center justify-center px-6")}>
      <Bloom />
      <motion.form
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.slow}
        onSubmit={(e) => {
          e.preventDefault();
          unlockAudio();
          const clean = value.trim().slice(0, 24);
          if (clean) onJoin(clean);
        }}
        className="relative z-10 w-full max-w-sm flex flex-col gap-6 text-center"
      >
        <div className="flex flex-col items-center gap-3">
          <span
            className="grid place-items-center rounded-pill w-20 h-20 text-large-title animate-float"
            style={{
              background: ballBg(solid),
              boxShadow:
                "0 14px 30px -10px oklch(0 0 0 / .6), inset 0 -8px 16px oklch(0 0 0 / .28), inset 0 8px 14px oklch(1 0 0 / .4)",
            }}
          >
            <span className="leading-none">{av.emoji}</span>
          </span>
          <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle">
            This is you
          </p>
        </div>

        <h1 className="font-display text-large-title font-bold leading-none">
          What should we call you?
        </h1>

        <Input
          className="h-16 text-center text-title2 font-display font-bold rounded-lg"
          placeholder="Nickname"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={24}
          autoFocus
          aria-label="Your nickname"
        />

        <Button type="submit" variant="primary" size="xl" disabled={!value.trim()}>
          Join the game
        </Button>
      </motion.form>
    </div>
  );
}

function Lobby({
  name,
  code,
  participants,
}: {
  name: string;
  code: string;
  participants: LobbyParticipant[];
}) {
  return (
    <div className={cn(PHONE_SHELL, "px-5 py-7 text-center")}>
      <Bloom />
      <div className="relative z-10 shrink-0">
        <p className="font-display text-title1 font-bold leading-tight">
          You're in, {name}
        </p>
        <p className="text-ink-subtle mt-1.5 text-subhead">Waiting for the host to start…</p>
        {/* The code they are actually in, echoed back.
            Join codes are six digits and rooms next door have them too, so a
            single mistyped digit lands a player in a real but wrong session —
            and before this the phone showed nothing they could check against.
            It waits here, where there is time to read it, and not on the
            question screen, where it would be noise. */}
        {code && (
          <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle mt-3">
            Room <span className="code text-ink-muted">{code}</span>
          </p>
        )}
      </div>

      <div className="relative z-10 flex-1 min-h-0 my-3">
        <PlayerBubbles participants={participants} />
      </div>

      <p className="relative z-10 shrink-0 text-ink-muted text-subhead font-semibold">
        <span className="nums text-accent text-title3">
          <NumberTicker value={participants.length} />
        </span>{" "}
        {participants.length === 1 ? "player" : "players"} ready
      </p>
    </div>
  );
}

function PlayerLeaderboard({ entries, meId }: { entries: LeaderboardEntry[]; meId: string }) {
  const mine = entries.find((e) => e.participantId === meId);
  const myRank = mine ? entries.indexOf(mine) + 1 : null;
  return (
    <div className={cn(PHONE_SHELL, "px-5 py-7")}>
      <Bloom />
      <p className="relative z-10 shrink-0 font-display text-title1 font-bold text-center">
        Leaderboard
      </p>
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto py-5">
        <BarRaceLeaderboard entries={entries} celebrateLeader />
      </div>
      {/* The "you" row is pinned so a player never has to hunt for themselves. */}
      {mine && (
        <div className="relative z-10 shrink-0 flex items-center justify-between gap-3 rounded-lg bg-surface-1 shadow-line px-4 py-3.5">
          <span className="text-footnote font-semibold uppercase track-label text-ink-subtle">
            You
          </span>
          <span className="flex items-baseline gap-2.5">
            <span className="nums text-accent text-title3 font-bold">#{myRank}</span>
            <span className="nums text-ink text-title3 font-bold">{mine.score}</span>
            <span className="text-ink-subtle text-footnote">pts</span>
          </span>
        </div>
      )}
    </div>
  );
}

function SessionEnded({
  entries,
  mine,
  myRank,
  onLeave,
}: {
  entries: LeaderboardEntry[];
  mine?: LeaderboardEntry;
  myRank: number | null;
  onLeave: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => burstFrom(rootRef.current, 110), 320);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn(PHONE_SHELL, "items-center justify-center px-5 py-7 gap-7 text-center overflow-y-auto")}
    >
      <Bloom />
      <p className="relative z-10 font-display text-title1 font-bold leading-tight">
        That's a wrap
      </p>
      {entries.length > 0 && (
        <div className="relative z-10">
          <Podium entries={entries} />
        </div>
      )}
      {mine && (
        <div className="relative z-10 flex flex-col items-center gap-1">
          <p className="text-ink-subtle text-footnote font-semibold uppercase track-label">
            You finished
          </p>
          <p className="nums font-display text-display font-bold text-accent leading-none">
            #{myRank}
          </p>
          <p className="text-ink-muted text-subhead">
            <span className="nums font-bold text-ink">{mine.score}</span> points
          </p>
        </div>
      )}
      {/* This screen had no controls at all — not one. A player whose host ran
          a second deck, or who was handed a new code, had no way forward from
          their own podium except finding the browser's address bar on a phone
          that was probably in a standalone-looking tab. A celebration is still
          a place you have to be able to walk out of.
          
          It sits below the result on purpose: the rank is the moment, and the
          door is for afterwards. */}
      <Button variant="secondary" size="lg" className="relative z-10" onClick={onLeave}>
        Join another game
      </Button>
    </div>
  );
}

function FeedbackCard({ feedback }: { feedback: SubmitFeedback }) {
  if (!feedback.isQuiz) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={spring.default}
        className="flex flex-col items-center gap-4 text-center py-10"
      >
        <span className="grid place-items-center w-20 h-20 rounded-pill bg-accent text-accent-ink text-large-title font-bold">
          ✓
        </span>
        <p className="font-display text-title2 font-bold">Answer locked in</p>
        <p className="text-ink-subtle text-subhead">Waiting for the next question…</p>
      </motion.div>
    );
  }

  // Before the reveal we deliberately do NOT say whether they were right —
  // that moment belongs to the shared screen, all at once.
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={spring.default}
      className="flex flex-col items-center gap-4 text-center py-10"
    >
      <span className="grid place-items-center w-20 h-20 rounded-pill bg-surface-2 shadow-line text-large-title">
        <span className="animate-float leading-none">⏳</span>
      </span>
      <p className="font-display text-title2 font-bold">Locked in</p>
      <p className="text-ink-subtle text-subhead">Hold tight — answer coming up.</p>
    </motion.div>
  );
}

// The resumed-player lock (M7). Shown when the join ack says the server
// already holds this participant's answer for the current slide but this tab
// has no graded result to show — they answered, then reconnected or reloaded.
//
// Its job is the lock, not the decoration: `participant:submit` upserts, so a
// live AnswerInput here lets one stray tap replace a scored answer with a
// late, zero-point one.
// A submit handler for the read-only echo below. The module is rendered purely
// to display a banked answer, so there is no caller to hand a value to.
const noop = () => {};

function AlreadyAnsweredCard({
  slide,
  isQuiz,
  myAnswer,
}: {
  slide: CurrentSlide;
  isQuiz: boolean;
  myAnswer: unknown;
}) {
  const def = slideType(slide.type);
  // Gap 2: the server has always sent `myAnswer` back on the join ack; the
  // shell just had nowhere to render it. Only the module knows that `2` means
  // slot C "Copenhagen" or that `{x,y}` is a pin, so the module renders it —
  // the shell only decides whether to ask.
  //
  // Gated on the module DECLARING `echoesValue`, never on guessing from the
  // value's shape: a module that does not implement `value` ignores it and
  // renders its full live input, which inside a "locked in" card is noise. An
  // absent flag means "no echo", which is why every untouched module — and
  // every module added later — keeps rendering the plain card unchanged.
  const EchoPlayer = def?.echoesValue && myAnswer != null ? def.Player : null;

  // The shell's own text echo, now the fallback rather than the only path. It
  // still covers OPEN_ENDED and TYPE_ANSWER, whose stored value already IS the
  // words the player typed and so needs no slide context to be legible.
  //
  // Mutually exclusive with the module echo by construction, not by belief
  // that the two cannot both fire: nothing stops a module that advertises an
  // echo from storing a bare string, and one answer rendered twice reads as a
  // bug. Where a module claims the value, it owns it.
  const echo =
    !EchoPlayer && typeof myAnswer === "string" && myAnswer.trim() ? myAnswer.trim() : null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={spring.default}
      className="flex flex-col items-center gap-4 text-center py-10"
    >
      <span className="grid place-items-center w-20 h-20 rounded-pill bg-surface-2 shadow-line text-large-title">
        <span className="leading-none">🔒</span>
      </span>
      <p className="font-display text-title2 font-bold">Already answered</p>
      {/* Between the heading and the status line on purpose. QA blessed this
       * card's copy for claiming nothing false — not which option, not whether
       * it was right — so the echo adds detail under it rather than replacing
       * it. `text-left` resets the card's centring: a ranking or a word list
       * is a column of rows, and centred rows read as decoration. */}
      {EchoPlayer && (
        <div className="w-full max-w-sm text-left">
          {/* Inert by construction. `disabled` is passed alongside `value`
           * because a module whose coercion fails — a stale option index after
           * a deck edit, an image dropped from a pin slide — falls back to its
           * real input, and `participant:submit` upserts: one stray tap there
           * would overwrite an already-scored answer with a late zero (M7). */}
          <EchoPlayer slide={slide} onSubmit={noop} disabled value={myAnswer} />
        </div>
      )}
      {echo && (
        <p className="text-ink-muted text-subhead max-w-[26ch] break-words">
          You sent “<span className="font-semibold text-ink">{echo}</span>”
        </p>
      )}
      <p className="text-ink-subtle text-subhead">
        {isQuiz
          ? "It's already scored — hold tight."
          : "Waiting for the next question…"}
      </p>
    </motion.div>
  );
}

// Shown once the presenter reveals. Correct option(s) keep their colour and
// gain a lime glow; the rest desaturate and dim (DESIGN.md §5 — never
// red/green). Then the player's own outcome folds in underneath.
function RevealCard({
  slide,
  reveal,
  feedback,
  answered,
}: {
  slide: CurrentSlide;
  reveal: Reveal;
  feedback: SubmitFeedback | null;
  /** The server has their answer even though this tab has no graded result. */
  answered: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const RevealBody = slideType(slide.type)?.Reveal;
  const wasRight = !!(feedback?.isQuiz && feedback.correct);

  useEffect(() => {
    if (!wasRight) return;
    const id = window.setTimeout(() => burstFrom(rootRef.current, 70), 260);
    return () => window.clearTimeout(id);
  }, [wasRight]);

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full flex flex-col gap-5"
    >
      {RevealBody && <RevealBody slide={slide} reveal={reveal.raw} feedback={feedback} />}

      <div className="text-center">
        {feedback?.isQuiz ? (
          <>
            <p
              className={cn(
                "font-display text-title1 font-bold",
                wasRight ? "text-accent" : "text-ink-muted"
              )}
            >
              {wasRight ? "Correct" : "Not this time"}
            </p>
            {wasRight && (
              <p className="nums text-accent text-title3 font-bold mt-0.5">
                +{feedback.points}
              </p>
            )}
            <p className="text-ink-subtle text-subhead mt-2">
              <span className="nums font-bold text-ink-muted">{feedback.totalScore}</span> pts ·
              rank <span className="nums font-bold text-ink-muted">#{feedback.rank}</span>
            </p>
          </>
        ) : feedback ? (
          <p className="font-display text-title2 font-bold">Answer submitted</p>
        ) : answered ? (
          // They answered, then reconnected or reloaded: the join ack proves
          // the response exists but carries no points or rank, so claim
          // nothing about the outcome. "You didn't answer in time" here would
          // simply be a lie to someone who did.
          <>
            <p className="font-display text-title2 font-bold">Answer locked in</p>
            <p className="text-ink-subtle text-subhead mt-1">
              Your score is up on the big screen.
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-title1 font-bold text-ink-muted">
              Time's up
            </p>
            <p className="text-ink-subtle text-subhead mt-1">You didn't answer in time.</p>
          </>
        )}
      </div>
    </motion.div>
  );
}

function AnswerInput({
  slide,
  onSubmit,
}: {
  slide: CurrentSlide;
  onSubmit: (value: unknown) => void;
}) {
  const def = slideType(slide.type);
  // Content slides have no player input. Without this the phone would be a
  // blank void for the whole slide, which reads as the app having broken
  // rather than as "nothing to do here".
  if (!def?.Player) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex flex-col items-center gap-3 text-center py-10"
      >
        <span className="grid place-items-center w-16 h-16 rounded-pill bg-surface-2 shadow-line text-title1">
          <span className="animate-float leading-none">👀</span>
        </span>
        <p className="font-display text-title3 font-bold">Eyes on the big screen</p>
        <p className="text-ink-subtle text-subhead max-w-[26ch]">
          Nothing to answer here — you can still react or ask a question.
        </p>
      </motion.div>
    );
  }
  const Player = def.Player;
  return (
    <motion.div exit={{ opacity: 0 }} className="w-full">
      <Player slide={slide} onSubmit={onSubmit} />
    </motion.div>
  );
}
