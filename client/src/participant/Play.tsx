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
import { ease, prefersReducedMotion, spring } from "../lib/motion";
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
  useConnection,
} from "../lib/connection";
import { noteServerNow, serverNow } from "../lib/serverClock";
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

/**
 * A leaderboard row as it reaches a PHONE.
 *
 * `LeaderboardEntry` is the shape the board components render; `pkey` is the
 * opaque self-identifier the server stamps alongside it, and is declared here
 * rather than there because only this surface asks "which row is mine?".
 * Optional on purpose — a server that predates it simply falls back.
 */
type BoardRow = LeaderboardEntry & { pkey?: string };

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

// One spelling of a score, on every surface that puts one on a screen.
//
// The podium printed `11,987 points` while the result card the player had been
// looking at two seconds earlier printed `11987 pts` — one number, two
// spellings, which is exactly the synonym DESIGN.md P1 exists to delete. Four
// digits is where it shows, and a twelve-question deck is there by question
// two. `toLocaleString` is what `Podium` and `BarRaceLeaderboard` already use,
// so this joins that spelling rather than inventing a third.
//
// Undefined renders as nothing, which is what interpolating it bare did: the
// embargoed submit ack carries no points at all until the reveal.
function fmt(n: number | undefined): string {
  return typeof n === "number" ? n.toLocaleString() : "";
}

// How often an unconfirmed submission is re-driven while the link is up (N7).
// Comfortably longer than the queue's own 6s ack deadline would need, and
// short enough that the phone resolves well inside a 20-second question.
const RESETTLE_MS = 2500;

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
  // This phone's own opaque key for THIS session, from the join ack.
  //
  // A board row used to be found by matching `participantId`, which meant
  // every row on every board a phone receives had to carry one — and a
  // `participantId` is a bearer token: it is the whole of what
  // `participant:join` needs to take someone's seat and overwrite their
  // answers. Ten rows on the standings was ten stealable seats handed to
  // every phone in the room. `pkey` is an HMAC of the id under a per-session
  // secret: it answers "is this row mine?" and nothing else, and it cannot be
  // turned back into an identity to join as.
  const myPkey = useRef<string | null>(null);
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
  const [finalEntries, setFinalEntries] = useState<BoardRow[]>([]);
  // This player's OWN final standing, told to this socket alone.
  //
  // It cannot be derived from `finalEntries`: that list is the public top ten
  // and it is capped there for a security reason, not a layout one — every row
  // carries a `participantId`, and a `participantId` is the whole of what
  // `participant:join` needs to take someone's seat. So the board stays ten
  // rows and the server sends each phone two scalars about itself instead.
  // Before this, everyone who finished 11th or below reached their own podium
  // and was told nothing at all about how they had done.
  const [myFinal, setMyFinal] = useState<{ rank: number; score: number } | null>(null);
  // Set only while the presenter has the leaderboard "on screen" — mirrors
  // the big-screen moment onto every phone at the same instant.
  const [leaderboardView, setLeaderboardView] = useState<BoardRow[] | null>(null);
  // ── THE RANK EMBARGO ──────────────────────────────────────────────────
  //
  // Has the ROOM been shown the standings since this player's last answer?
  // Until it has, nobody — including this phone — is entitled to a rank.
  //
  // `participant:submit` acks with `{ correct, points, totalScore, rank }`.
  // The first three are this player's own business and go out immediately:
  // "you were right, that was worth 973" is feedback, and withholding it
  // would only make the phone useless. `rank` is not like them. It is a claim
  // about everyone else, and the stage's whole second peak — the bar race, a
  // 900ms hold in the remembered order followed by 1150ms of watching the
  // overtakes happen — exists to deliver exactly that claim to the whole room
  // at once.
  //
  // Measured before this existed: at the answer reveal, with the stage still
  // showing the answer tiles and the standings yet to be called up, Devika's
  // phone read "Correct +973 · 973 pts · rank #1" and Ayesha's read "Not this
  // time · 823 pts · rank #2". Every phone in the room was holding the result
  // of a race that had not been run. The race was theatre for a result the
  // audience already had in their hands.
  //
  // So the number waits for the room. What it does NOT do is wait forever —
  // see `visibleRank` below for the self-paced case, where the server
  // guarantees there is no shared moment to wait for.
  const [standingsSeen, setStandingsSeen] = useState(false);
  // …and this player's row in that board, when it reached far enough down to
  // list them. Preferred over the submit ack's `rank` once we have it: the
  // ack's number is this player's place at the instant THEY answered, which
  // everyone else answering has since moved. Showing a stale #2 directly
  // after a race that just put them 3rd would be the same defect pointing the
  // other way. The server sends a top ten, so a player below it is absent and
  // we fall back to the ack — by then the moment has passed and a slightly
  // old number spoils nothing.
  const [publicRank, setPublicRank] = useState<number | null>(null);
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

  // Is this board row this player's own?
  //
  // By `pkey` wherever both ends have one, and by `participantId` otherwise —
  // which is only ever a server that predates `myPkey`, or a board whose rows
  // predate `pkey`. Keeping the fallback is what lets the id leave the wire
  // independently of this file shipping.
  const isMyRow = (row: BoardRow): boolean => {
    if (myPkey.current && row.pkey) return row.pkey === myPkey.current;
    return row.participantId === participantId.current;
  };

  // Live connection status and the number of submissions the server has not
  // confirmed. Read here, not only inside `ConnectionBanner`, because an
  // unconfirmed submission is a state this screen has to RESOLVE and not just
  // describe — see the watchdog below.
  const { status: connectionStatus, queued } = useConnection();

  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    // The room has just been shown the standings. This is the ONLY thing that
    // lifts the rank embargo in a presenter-paced deck, and it is lifted by
    // the broadcast rather than by anything this phone did — which is the
    // whole point: the number becomes public when it becomes public.
    const roomSawStandings = (entries: BoardRow[]) => {
      setStandingsSeen(true);
      const i = entries.findIndex(isMyRow);
      setPublicRank(i >= 0 ? i + 1 : null);
    };

    // Runs for the first join AND for every reconnect re-join — the ack is
    // specified to be correct for both, so one handler serves both.
    //
    // `rttMs` is how long this ack took to come back, when the caller timed
    // it; the clock sample inside is stamped at the far end of that trip.
    const applyJoinAck = (res: any, isRejoin: boolean, rttMs = 0) => {
      // FIRST, ahead of every setState below: `startedAt` is only meaningful
      // next to the server's own "now", and the effects that arm the
      // countdown run after this handler returns, so the offset has to be
      // recorded before the state that depends on it (lib/serverClock.ts).
      noteServerNow(res?.serverNow, rttMs);
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
          // The refusal carries the result it is refusing on behalf of, so a
          // reload on the podium comes back to the podium. Without these two
          // lines `ended` was set with nothing behind it and the screen read
          // "That's a wrap" over blank space — F3: a place you return to looks
          // the way you left it. Guarded so an older server, which sends the
          // refusal bare, still reaches the ending rather than an error.
          if (Array.isArray(res.entries)) setFinalEntries(res.entries);
          if (typeof res.myRank === "number") {
            setMyFinal({ rank: res.myRank, score: res.myScore ?? 0 });
          }
          setEnded(true);
          return;
        }
        setError(res.error);
        return;
      }
      setError("");
      // Before any board is applied below: `roomSawStandings` runs off this.
      // A server that predates it leaves us on the id comparison (`isMyRow`).
      myPkey.current = typeof res.myPkey === "string" ? res.myPkey : null;
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
        const live = res.leaderboardView ? (res.leaderboardView.entries ?? []) : null;
        setLeaderboardView(live);
        // A phone that reloads INTO the standings is in the shared moment
        // like everyone else, so the embargo lifts for it too. Lifting it
        // from the ack and not only from the broadcast is what stops a
        // reload from telling a player LESS than the phone next to them.
        if (live) roomSawStandings(live);
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
      // Their graded result, restored from the server rather than from
      // whatever this tab happens to remember.
      //
      // `myResult` is the submit ack's own shape — `{ isQuiz, correct,
      // points, totalScore, rank }` — so a reconnecting phone comes back
      // through the same path a fresh submission takes. Before this the only
      // copy lived in component state, so a reload after answering returned a
      // card with no "Correct", no "+1000" and no rank: strictly less than
      // the phone had held a second earlier, and for a self-paced player
      // (above) that card is now their ONLY result, so losing it loses the
      // moment outright.
      //
      // Safe against the rank embargo, and safe by the same mechanism that
      // has always made the submit ack's rank safe: nothing renders
      // `feedback.rank` directly. `visibleRank` is the single reader, and for
      // PRESENTER it still returns null until `standingsSeen` — which only
      // `roomSawStandings` sets, from the broadcast or from a non-null
      // `leaderboardView` on this very ack. Restoring a result therefore
      // cannot hand a host-paced player a rank the room has not been shown.
      //
      // Three cases, and the distinction between the last two matters:
      //   • an object — the server has a graded row; take it, it is fresher
      //     than ours (its totalScore and rank are computed now).
      //   • `null` — the server says this phone has no scored result on the
      //     slide in front of it. Falls through to the pre-existing rule.
      //   • `undefined` — a server that predates the field. Also falls
      //     through, so this is a pure addition for old servers.
      //
      // The fall-through rule is the original one: keep any feedback we
      // already earned on this very slide, because clearing it would
      // downgrade "Correct +992" to a bare lock. On any other slide it is
      // stale and must go.
      if (res.myResult) {
        setFeedback(res.myResult);
        // And bank it for the self-paced walk-back. `participant:goto` acks
        // with no `answered`/`myAnswer`/`myResult` at all, so this map is the
        // ONLY thing that can answer "did I already do that one" for a slide
        // the player steps back to. Until now the join ack never wrote to it,
        // so a reloaded phone that stepped away and back got four live tiles
        // over a scored answer — and `participant:submit` upserts (M7).
        if (res.currentSlide?.id) {
          answeredSlides.current.set(res.currentSlide.id, {
            value: res.myAnswer ?? null,
            feedback: res.myResult,
          });
        }
      } else if (!sameSlide) {
        setFeedback(null);
      }
      setSubmitError("");
      // Release anything the outage left queued, but only when we came back to
      // the slide it belongs to. `setRetryQueueSlide` does not run until the
      // re-render below, so flushing after a slide change here would re-send
      // an answer into a question the room has already left.
      if (sameSlide) flushQueue();
    };

    const emitJoin = (isRejoin: boolean) => {
      // Timed purely so the clock sample in the ack can be placed in the
      // middle of the round trip rather than at its start.
      const sentAt = Date.now();
      socket.emit(
        "participant:join",
        {
          joinCode: code,
          participantId: participantId.current,
          name,
          avatar: getAvatarIndex(),
        },
        (res: any) => applyJoinAck(res, isRejoin, Date.now() - sentAt)
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
      // Before the state it belongs to, for the reason in `applyJoinAck`.
      noteServerNow(payload?.serverNow);
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
      // A new question is a new claim about the room, so the embargo re-arms.
      // The standings the room saw after the LAST question say nothing about
      // where this one leaves anybody, and leaving the gate open would hand
      // every phone its rank at the next reveal — the exact leak this closes.
      setStandingsSeen(false);
      setPublicRank(null);
      setReveal(null);
      // A new slide is a new answer: the M7 lock is per-slide, not per-session.
      setAnswered(false);
      setMyAnswer(null);
      setSubmitError("");
    };

    const onReveal = (payload: any) => {
      noteServerNow(payload?.serverNow);
      // Read from the ref, not from inside a `setCurrentSlide` updater. An
      // updater is called for its RETURN VALUE and React may run it twice —
      // it does, in development — so everything below, the sound included,
      // used to happen twice per reveal. The ref is written in every place
      // the state is, one line apart, so it answers the same question.
      {
        const slide = currentSlideRef.current;
        if (slide && payload.slideId === slide.id) {
          const next = { raw: payload ?? {}, aggregate: payload?.aggregate };
          setReveal(next);
          // Kept for the self-paced walk-back, same reason as the answer: the
          // `participant:goto` ack carries no reveal, so a revisited slide
          // would otherwise say "answer coming up" about an answer this player
          // already watched arrive.
          revealedSlides.current.set(payload.slideId, next);

          // ── THE RESULT ARRIVES WITH THE REVEAL ───────────────────────────
          //
          // Under host pacing the submit ack no longer carries the outcome —
          // it was an answer-key oracle, returning `correct` to anyone who
          // asked, before the room had been told anything (N3). The embargo
          // used to live entirely in `FeedbackCard`, one layer ABOVE the data,
          // so a scripted client simply read the ack.
          //
          // The result now rides the reveal instead: the frame that already
          // delivers the answer key to the room, stamped per socket with this
          // player's own `{ isQuiz, correct, points, totalScore, rank }` —
          // the same shape `participant:join` has always acked with. What the
          // player SEES is unchanged: "Locked in / Hold tight" until the
          // reveal, the full result after it. Only the layer it arrives on
          // has moved, and that layer is one the server controls.
          //
          // Only ever read when it is an object. `null` means the server has
          // no scored row for this phone — they did not answer — and
          // `undefined` means a server that predates the field, whose ack
          // already carried the result. Neither may CLEAR feedback we hold:
          // doing so would downgrade a real result to "You didn't answer".
          const mine = payload?.myResult;
          if (mine) {
            setFeedback(mine);
            // The server has a graded row for us, so the M7 lock is true even
            // if this tab never saw its own ack land (N7).
            setAnswered(true);
            setSubmitError("");
            const prior = answeredSlides.current.get(payload.slideId);
            answeredSlides.current.set(payload.slideId, {
              value: prior?.value ?? null,
              feedback: mine,
            });
          }
          // The verdict sting, at the only moment the player is entitled to
          // the verdict. It used to fire on the submit ack, which under host
          // pacing meant the phone said "right" out loud a whole question
          // before the room was told — the same breach as N3, in audio. One
          // sound per reveal either way: a player with a result of their own
          // hears that, and everyone else hears the generic reveal.
          if (mine?.isQuiz && typeof mine.correct === "boolean") {
            playSound(mine.correct ? "correct" : "wrong");
          } else {
            playSound("reveal");
          }
        }
      }
    };

    const onCount = (payload: any) => setParticipants(payload?.participants ?? []);
    const onLeaderboardShow = (payload: any) => {
      const entries: BoardRow[] = payload.entries ?? [];
      setLeaderboardView(entries);
      roomSawStandings(entries);
    };
    const onLeaderboardHide = () => setLeaderboardView(null);
    const onEnded = (payload: any) => {
      setEnded(true);
      setFinalEntries(payload?.entries ?? []);
      // `null` is a real answer here — a presenter socket, or a participant who
      // never submitted anything and so has no position to hold. Only an older
      // server leaves the fields off entirely, and that falls back below.
      setMyFinal(
        typeof payload?.myRank === "number"
          ? { rank: payload.myRank, score: payload.myScore ?? 0 }
          : null
      );
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
    const sentAt = Date.now();
    getSocket().emit(
      "participant:goto",
      { joinCode: code, participantId: participantId.current, index: next },
      (res: any) => {
        // This ack carries a `startedAt` of its own (a self-paced player's
        // arrival on the slide), so it carries the clock it must be read
        // against. Before the state, as everywhere else.
        noteServerNow(res?.serverNow, Date.now() - sentAt);
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
    // The server's clock on both sides of the subtraction, exactly as the ring
    // does it. With the phone's own clock here, a device set 90s fast armed
    // this on mount and told a self-paced player their speed bonus was gone
    // 58 seconds before it was (N10).
    const left = startedAt + timeLimit * 1000 - serverNow();
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

  // ── N7: THE PHONE HAS TO SETTLE ON ITS OWN ────────────────────────────────
  //
  // Measured: a 12-second question, the phone taken offline, an answer tapped,
  // the network back 9.5s later. The server received the answer and scored it
  // 531 — the stage showed it — while the phone read "Sending your answer… 1
  // waiting" for 33 seconds and then, at the reveal, "You didn't answer in
  // time". Both strings on screen at once. It recovered only at t=35s, when
  // socket.io's heartbeat finally declared the dead transport dead and the
  // reconnect flushed the queue; with the outage in a different part of the
  // ping cycle that is up to ~45s, and a reload was the only sure fix.
  //
  // The mechanism is narrow. `socket.timeout(6000).emit()` registers an ack
  // handler and DELETES it when it fires, so the submit that was delivered
  // late — by a TCP retransmit, or by socket.io's own disconnect buffer —
  // gets a perfectly good ack from the server that the client has no handler
  // for any more. The queue settles only on an ack body, which is correct;
  // the body simply never reaches it. Nothing else was watching, because the
  // socket never disconnected and so `connect` never fired the flush.
  //
  // So: while something is unconfirmed and the link is up, re-drive it. The
  // re-send is the same bytes, and the server answers identical bytes from
  // the row it already holds — ahead of its own "Time's up" guard, with
  // `duplicate: true` and the real points — so this settles the phone with
  // the TRUE result and cannot re-grade, double-score, or cost the player the
  // outage. If the answer genuinely never arrived, the re-send either lands
  // (and scores) or is refused, and either way the queue drains and the
  // player is told something true instead of two contradictory things.
  //
  // Cheap by construction: the interval exists only while `queued > 0` AND
  // the connection is up, which is close to never. `flushQueue` skips
  // anything already in flight, so the first re-drive lands one tick after
  // the 6-second ack deadline rather than piling emits on top of each other.
  useEffect(() => {
    if (!joined || queued === 0 || connectionStatus !== "online") return;
    const id = window.setInterval(flushQueue, RESETTLE_MS);
    return () => window.clearInterval(id);
  }, [joined, queued, connectionStatus]);

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
      // Under host pacing, before the reveal, this ack is now `{ ok, isQuiz }`
      // and nothing else — the verdict is embargoed on the WIRE rather than
      // in the card (N3). `FeedbackCard` renders exactly what it rendered
      // before from it: "Locked in / Hold tight" for a quiz slide, "Answer
      // locked in" for anything else. The rest of the result arrives on
      // `slide:reveal`, and arrives in full on this ack in every case where
      // the embargo does not apply: a self-paced deck, or a slide already
      // revealed (which is how a queued answer delivered late settles).
      setFeedback(res);
      setAnswered(true);
      setMyAnswer(value);
      // Keep it. In a self-paced deck the player can walk back here, and the
      // server's `participant:goto` ack does not carry `answered`/`myAnswer`
      // the way the join ack does — so this tab is the only thing that knows.
      answeredSlides.current.set(currentSlide.id, { value, feedback: res });
      // Only when the ack actually carried a verdict. Firing on a bare
      // `isQuiz` would play the "wrong" sting at every embargoed submit —
      // telling the player, in audio, the opposite of what they scored.
      if (res.isQuiz && typeof res.correct === "boolean") {
        playSound(res.correct ? "correct" : "wrong");
      }
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
    const mine = finalEntries.find(isMyRow);
    // The server's own figure first. Falling back to a position in the public
    // board keeps this working against a server that predates the field — but
    // that fallback is exactly the thing that could only ever answer for the
    // top ten, so it is the fallback and not the source.
    const myPlace =
      myFinal ??
      (mine ? { rank: finalEntries.indexOf(mine) + 1, score: mine.score } : null);
    return (
      <SessionEnded
        entries={finalEntries}
        myPlace={myPlace}
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
      <PlayerLeaderboard
        entries={leaderboardView}
        isMine={isMyRow}
        // Scoped to the ROOM, not to the surface.
        //
        // `BarRaceLeaderboard` remembers the last board each `raceKey`
        // rendered, in a module-scoped Map that outlives this component — by
        // design, since the component only exists while the standings are up,
        // which is what makes "the last board I drew" equal to "the board the
        // room last saw". A constant key broke that equality across GAMES: a
        // player who finishes one session and joins another in the same tab
        // raced the new room's first standings out of the dead game's scores,
        // which is a bar interpolating from a number that has nothing to do
        // with this room (bars measured running hundreds of px off-screen).
        //
        // The join code is the most session-specific identifier this
        // component has — a session id would be better, but neither the
        // `participant:join` ack nor any participant broadcast carries one.
        // Codes are minted per session (`genJoinCode`, random six digits,
        // retried against the live table), so a second game is a second key
        // in practice. The presenter surface has to agree on the scheme for
        // the fix to be whole; its half is `BarRaceLeaderboard`'s own.
        raceKey={`phone:${code ?? ""}`}
      />
    );
  }

  if (status === "LOBBY" || !currentSlide) {
    return <Lobby name={name} code={code ?? ""} participants={participants} />;
  }

  // What rank, if any, this player may be shown right now. See the embargo
  // note on `standingsSeen`.
  //
  // AUDIENCE pacing is the exception, and it is not a concession — it is the
  // same rule applied to a deck that has no shared moment. `armRevealTimer`
  // returns early for self-paced decks, by design and with a comment saying
  // so, because at any instant different people are on different slides;
  // there is no frame at which the room could see the standings together, and
  // the host may never call them up at all. Withholding until a beat that
  // never arrives is not suspense, it is a bug that looks like missing data.
  // So a self-paced player gets the ack's rank the moment they earn it, which
  // is also the only number that exists for them.
  const visibleRank =
    pacing === "AUDIENCE"
      ? (feedback?.rank ?? null)
      : standingsSeen
        ? (publicRank ?? feedback?.rank ?? null)
        : null;

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
                rank={visibleRank}
              />
            ) : feedback ? (
              // `pacing` and `rank` are what let this card be a RESULT rather
              // than a holding pattern in a self-paced deck, where no reveal
              // is ever coming (R3 — see the note above `SelfPacedQuizResult`).
              // `visibleRank`, never `feedback.rank`: the embargo is the
              // shell's decision, exactly as it is for `RevealCard`.
              <FeedbackCard
                key="feedback"
                feedback={feedback}
                pacing={pacing}
                rank={visibleRank}
              />
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

function PlayerLeaderboard({
  entries,
  isMine,
  raceKey,
}: {
  entries: BoardRow[];
  /** Which row is this player's own — by `pkey`, see `isMyRow`. */
  isMine: (row: BoardRow) => boolean;
  /**
   * Scopes the remembered board to the SESSION, not just to this surface —
   * see the call site.
   */
  raceKey: string;
}) {
  const mine = entries.find(isMine);
  const myRank = mine ? entries.indexOf(mine) + 1 : null;
  // The phone runs the same race the stage does, so it can spoil it the same
  // way — and it did, from its own pinned row, one surface below the leak
  // this screen exists to protect. Measured: the row read "#1" on the frame
  // the board landed, while the bars beside it were still held in the old
  // order with that player's own bar sitting at 0 in sixth.
  //
  // So the rank arrives on the settle beat, with the +Δ chips, on the board's
  // own clock rather than a timer of its own. The SCORE does not wait: it is
  // this player's own number, it is already racing in their row, and holding
  // it back would be withholding feedback rather than a result.
  const [raceSettled, setRaceSettled] = useState(false);
  // Read once, like the race does. Under reduced motion `onSettled` fires on
  // mount, so this fade is all that stands between the reader and the number:
  // §6 allows a 120ms opacity crossfade and nothing longer.
  const reduced = useRef<boolean | null>(null);
  if (reduced.current === null) reduced.current = prefersReducedMotion();
  return (
    <div className={cn(PHONE_SHELL, "px-5 py-7")}>
      <Bloom />
      <p className="relative z-10 shrink-0 font-display text-title1 font-bold text-center">
        Leaderboard
      </p>
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto py-5">
        <BarRaceLeaderboard
          entries={entries}
          raceKey={raceKey}
          celebrateLeader
          onSettled={() => setRaceSettled(true)}
        />
      </div>
      {/* The "you" row is pinned so a player never has to hunt for themselves. */}
      {mine && (
        <div className="relative z-10 shrink-0 flex items-center justify-between gap-3 rounded-lg bg-surface-1 shadow-line px-4 py-3.5">
          <span className="text-footnote font-semibold uppercase track-label text-ink-subtle">
            You
          </span>
          <span className="flex items-baseline gap-2.5">
            {/* Opacity, never mount/unmount: the number stays in the layout
             * (so the score never shifts under it) and stays in the
             * accessibility tree (so a screen-reader user, who is not
             * watching bars travel, is not made to wait for a picture). With
             * no race to wait for — a cold board, an unchanged one, or
             * `prefers-reduced-motion` — `onSettled` fires on mount, so this
             * is visible from frame one and the rank never ends up living
             * only inside an animation. */}
            <motion.span
              className="nums text-accent text-title3 font-bold"
              initial={{ opacity: 0 }}
              animate={{ opacity: raceSettled ? 1 : 0 }}
              transition={{ duration: reduced.current ? 0.12 : 0.26, ease: ease.entrance }}
            >
              #{myRank}
            </motion.span>
            <span className="nums text-ink text-title3 font-bold">{mine.score.toLocaleString()}</span>
            <span className="text-ink-subtle text-footnote">pts</span>
          </span>
        </div>
      )}
    </div>
  );
}

function SessionEnded({
  entries,
  myPlace,
  onLeave,
}: {
  entries: LeaderboardEntry[];
  /** This player's own finish. `null` only for someone who never answered. */
  myPlace: { rank: number; score: number } | null;
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
      {/* Gated on the player's own result, NOT on finding themselves in the
       * board above — which is how 11th place used to end a whole game with a
       * podium of strangers and no line of their own. */}
      {myPlace && (
        <div className="relative z-10 flex flex-col items-center gap-1">
          <p className="text-ink-subtle text-footnote font-semibold uppercase track-label">
            You finished
          </p>
          <p className="nums font-display text-display font-bold text-accent leading-none">
            #{myPlace.rank}
          </p>
          <p className="text-ink-muted text-subhead">
            <span className="nums font-bold text-ink">{myPlace.score.toLocaleString()}</span> points
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

function FeedbackCard({
  feedback,
  pacing,
  rank,
}: {
  feedback: SubmitFeedback;
  /**
   * Which kind of deck this is. The holding card at the bottom of this
   * function is correct for PRESENTER and was never right for AUDIENCE — see
   * the note above `SelfPacedQuizResult`.
   */
  pacing: "PRESENTER" | "AUDIENCE";
  /**
   * This player's place in the room, or null while it is still embargoed.
   * The shell's `visibleRank`, and deliberately NOT read off `feedback.rank`
   * — same reason `RevealCard` takes it as a prop: the shell is the only
   * thing that knows whether the room has had its standings moment yet.
   */
  rank: number | null;
}) {
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

  // A self-paced deck has no shared screen moment to protect, so the whole
  // reason for the withholding below does not apply to it. Everything after
  // this line is the PRESENTER card, unchanged.
  if (pacing === "AUDIENCE") {
    return <SelfPacedQuizResult feedback={feedback} rank={rank} />;
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

// R3 — the self-paced player's result, on their own phone, at the moment they
// earn it.
//
// `FeedbackCard` withholds the outcome until the reveal, and for a
// presenter-paced deck that is exactly right: the result belongs to the shared
// screen, delivered to the whole room on one frame, and a phone that says it
// first spends that frame. A SELF-PACED deck has no such frame.
// `armRevealTimer` returns early for AUDIENCE pacing by design and with a
// comment saying why — a room whose premise is that everyone is on a different
// slide has no instant a reveal could land on — and the "everyone present has
// answered" early reveal cannot be relied on for the same reason. So the card
// that was written to hold for a few seconds held forever.
//
// Measured before this existed, on an AUDIENCE deck with three players: Ana
// answered Q1 correctly, the server scored her 1000 and `get-leaderboard` put
// her at #1, and her phone read "Locked in / Hold tight — answer coming up."
// at t=2s, 10s, 25s and 45s. Nothing in the deck would ever have changed it.
// The only thing that patched it was the host calling up the standings, and
// the moment the board came down the card reverted.
//
// This is the same exception `visibleRank` already makes one level down,
// applied at the level that decides whether anything is said at all.
//
// WHAT IT DOES NOT SHOW: the answer key. It draws no options, no correct
// slot, nothing from the slide — only the four numbers this player's own
// submit ack handed back about themselves. `RevealCard` is still the only
// thing that renders the key, and it still mounts only when the server has
// actually revealed the slide to this phone.
function SelfPacedQuizResult({
  feedback,
  rank,
}: {
  feedback: SubmitFeedback;
  rank: number | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wasRight = !!feedback.correct;
  // Read once, the way the rest of the file does. Under reduced motion the
  // card still arrives and still says everything it says — only the travel
  // goes (DESIGN.md §6), so the scale is pinned and the entrance becomes the
  // opacity-only spring. `burstFrom` already no-ops for these readers.
  const reduced = useRef<boolean | null>(null);
  if (reduced.current === null) reduced.current = prefersReducedMotion();

  useEffect(() => {
    if (!wasRight) return;
    const id = window.setTimeout(() => burstFrom(rootRef.current, 70), 260);
    return () => window.clearTimeout(id);
  }, [wasRight]);

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, scale: reduced.current ? 1 : 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={reduced.current ? spring.effect : spring.default}
      className="flex flex-col items-center gap-4 text-center py-10"
    >
      {/* DESIGN.md §5: correct is accent + ✓ + glow, incorrect is desaturate
       * + dim + ✕ + scale down. Never red/green. The disc is `FeedbackCard`'s
       * own shape — the same 80px pill the "Answer locked in" card uses — so
       * this reads as that card having resolved rather than as a new screen. */}
      <span
        className={cn(
          "grid place-items-center w-20 h-20 rounded-pill",
          wasRight
            ? "bg-accent text-accent-ink text-large-title font-bold shadow-glow"
            : "bg-surface-2 shadow-line text-ink-subtle text-title1"
        )}
      >
        <span className="leading-none">{wasRight ? "✓" : "✕"}</span>
      </span>

      {/* Deliberately `RevealCard`'s ledger, line for line and class for
       * class, rather than a third vocabulary for the same four facts: the
       * verdict, the points this question was worth, the running total, and
       * the rank. A player who meets both cards in one session — a self-paced
       * deck whose host does reveal a slide by hand — should not have to
       * learn the result twice. */}
      <div>
        <p
          className={cn(
            "font-display text-title1 font-bold",
            wasRight ? "text-accent" : "text-ink-muted"
          )}
        >
          {wasRight ? "Correct" : "Not this time"}
        </p>
        {wasRight && (
          <p className="nums text-accent text-title3 font-bold mt-0.5">+{fmt(feedback.points)}</p>
        )}
        <p className="text-ink-subtle text-subhead mt-2">
          <span className="nums font-bold text-ink-muted">{fmt(feedback.totalScore)}</span> pts
          {rank !== null && (
            <>
              {" · "}rank <span className="nums font-bold text-ink-muted">#{rank}</span>
            </>
          )}
        </p>
      </div>

      {/* No "tap Next" line. The self-paced nav bar is rendered 40px below
       * this card with the live slide counter in it, and two spellings of one
       * fact is the defect P1 exists to prevent — the same reason the header
       * drops its "3 of 12" in this pacing. */}
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
  rank,
}: {
  slide: CurrentSlide;
  reveal: Reveal;
  feedback: SubmitFeedback | null;
  /** The server has their answer even though this tab has no graded result. */
  answered: boolean;
  /**
   * This player's place in the room, or null while it is still embargoed.
   * Deliberately NOT read off `feedback.rank`, which the ack has always
   * carried: the embargo is decided by the shell, which is the only thing
   * that knows whether the room has had its standings moment yet.
   */
  rank: number | null;
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
                +{fmt(feedback.points)}
              </p>
            )}
            {/* Their own ledger. The score is theirs and goes out whole; the
             * rank is the room's and waits for the room (see `visibleRank`).
             *
             * When it is withheld the line is not simply shorter — a blank
             * where a number was reads as data we failed to fetch. It is
             * replaced by the one true thing we can say about the missing
             * number, which also happens to be the hook the whole moment
             * runs on: it is about to happen over there. */}
            <p className="text-ink-subtle text-subhead mt-2">
              <span className="nums font-bold text-ink-muted">{fmt(feedback.totalScore)}</span> pts
              {rank !== null && (
                <>
                  {" · "}rank <span className="nums font-bold text-ink-muted">#{rank}</span>
                </>
              )}
            </p>
            {rank === null && (
              <p className="text-ink-subtle text-subhead mt-1">
                Watch the big screen for where that puts you.
              </p>
            )}
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
