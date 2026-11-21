import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "motion/react";
import { getSocket } from "../lib/socket";
import { api, getToken } from "../lib/api";
import { isLoopbackHost, resolveJoinOrigin } from "../lib/config";
import { emitWithAck, useConnection, type AckOutcome } from "../lib/connection";
import { downloadSessionCsv } from "../lib/sessionExport";
import { FooterNotice, type Notice } from "../components/presenter/FooterNotice";
import { ShortcutSheet } from "../components/presenter/ShortcutSheet";
import { applyStage, getStage, setStage, type Stage } from "../lib/theme";
import { applyTheme } from "../lib/themes";
import { QaModeration } from "../components/qa/QaModeration";
import { QaStage } from "../components/qa/QaStage";
import { ReactionOverlay } from "../components/reactions/ReactionOverlay";
import {
  closeSpeakerWindow,
  openSpeakerWindow,
  speakerWindowOpen,
  updateSpeakerWindow,
  type SpeakerTransport,
} from "../components/SpeakerWindow";
import { slideType } from "../slides/registry";
import { Podium, LeaderboardList, type LeaderboardEntry } from "../components/Podium";
import { BarRaceLeaderboard } from "../components/BarRaceLeaderboard";
import { PlayerBubbles } from "../components/PlayerBubbles";
import { useStageScale } from "../components/stageScale";
import type { RowIdentity } from "../components/participantKey";
import { NumberTicker } from "../components/ui/NumberTicker";
import { TimerRing } from "../components/ui/TimerRing";
import { noteServerNow, startClockSync } from "../lib/serverClock";
import { FitText } from "../components/ui/FitText";
import { Button } from "../components/ui/Button";
import { initSound, isMuted, playSound, subscribeMuted, toggleMuted, unlockAudio } from "../lib/sound";
import { MoreMenu, type MoreAction } from "../components/MoreMenu";
import { clearPresenting, markPresenting, markRunFinished } from "../lib/liveSession";
import {
  getRevealUpcoming,
  getShownSlides,
  saveShownSlides,
  setRevealUpcoming,
} from "../lib/presenterPrefs";
import { SlideNavigator } from "../components/SlideNavigator";
import { burstAt, burstFrom } from "../lib/confetti";

interface CurrentSlide {
  id: string;
  type: string;
  question: string;
  config: any;
  order: number;
}

// The roster row, as this surface uses it: a name, a hue and an identity to
// key a bubble by. A presenter socket still receives `participantId` and may,
// but nothing here reads it — `PlayerBubbles` keys off `pkeyOf`, the one field
// both audiences get (components/participantKey.ts) — so the shape is written
// so a frame carrying either one is enough.
interface Participant extends RowIdentity {
  name: string;
  avatar: number;
}

type Pacing = "PRESENTER" | "AUDIENCE";

/**
 * A failure from BEFORE there was a session. This is the only kind that may
 * take over the whole screen: there is no room behind it to protect, and a
 * host staring at a dead lobby needs a reason and a door more than a stage.
 * Everything that goes wrong once a join code exists is a notice in the
 * control bar instead (see `notice`) — a live session with twenty-eight
 * phones in it must never go blank because of a browser setting.
 */
interface Fatal {
  title: string;
  detail: string;
  /** The deck is the problem, so the editor is the right door. */
  editDoor?: boolean;
  /** Nothing is wrong with the deck; the wire was. Offer to try again. */
  retry?: boolean;
}

function fatalFor(code: string | null, error: string): Fatal {
  switch (code) {
    case "EMPTY_DECK":
      return { title: "This deck has no slides yet", detail: "Add a slide in the editor, then present it.", editDoor: true };
    case "DECK_GONE":
      return { title: "This deck no longer exists", detail: "It may have been deleted from another window." };
    case "UNAUTHORIZED":
      return { title: "You're signed out", detail: "Sign in again, then open the deck from your decks." };
    case "TIMEOUT":
    case "OFFLINE":
      return { title: "Couldn't reach the server", detail: "Check the connection, then try again.", retry: true };
    default:
      return { title: "Couldn't open this deck", detail: error || "Something went wrong." };
  }
}

/**
 * What a refused command means to the host, in the bar. Two of these are
 * final — the session is gone or this account may not drive it — and stay
 * until acted on; the rest are one lost press, said once.
 */
function noticeFor(r: Extract<AckOutcome, { ok: false }>, verb: string, decks: () => void): Notice {
  switch (r.code) {
    case "SESSION_GONE":
    case "NO_LIVE_SESSION":
      return { text: "This session no longer exists", warn: true, sticky: true, door: { label: "← Decks", onSelect: decks } };
    case "SESSION_ENDED":
      return { text: "The session has ended", warn: true, sticky: true, door: { label: "← Decks", onSelect: decks } };
    case "UNAUTHORIZED":
      return { text: "You're signed out — this room didn't accept the command", warn: true, sticky: true, door: { label: "← Decks", onSelect: decks } };
    case "OFFLINE":
      return { text: `You're offline — ${verb} wasn't sent`, warn: true };
    case "TIMEOUT":
      return { text: `${verb} didn't reach the server — check the connection and press again`, warn: true };
    default:
      return { text: `${verb} was refused: ${r.error}`, warn: true };
  }
}

/** How long a transient notice stays before it clears itself. */
const NOTICE_MS = 6000;

export default function Present() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [status, setStatus] = useState<"LOBBY" | "ACTIVE" | "ENDED">("LOBBY");
  const [index, setIndex] = useState(-1);
  const [totalSlides, setTotalSlides] = useState(0);
  const [currentSlide, setCurrentSlide] = useState<CurrentSlide | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Server-authoritative, already scaled by the deck's relaxed-timing setting.
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [aggregate, setAggregate] = useState<any>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>([]);
  // Two kinds of wrong, two surfaces (1.1). `fatal` is pre-session only and
  // owns the screen; `notice` is anything after a join code exists and lives
  // in the control bar, where the host reads and the room does not.
  const [fatal, setFatal] = useState<Fatal | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // From the session ack. Under AUDIENCE pacing the server arms no clock, so
  // the stage renders none (PULSE.md T3: a countdown whose zero costs nothing
  // is theatre). Defaults to host-paced, which is what every ack before this
  // field existed meant.
  const [pacing, setPacing] = useState<Pacing>("PRESENTER");
  // Named on the stage, from the REST deck rather than the ack: the ack
  // carries titles for every slide and none for the deck, and the editor's
  // own fetch already knows it (F4 — the screen where the wrong deck is most
  // expensive is the one that never said which deck it was).
  const [deckTitle, setDeckTitle] = useState<string | null>(null);
  // B/W: the projector goes dark or white; the session does not. The cheap
  // non-destructive act that was missing, so `End` was the only way to take
  // the stage down (1.5).
  const [blank, setBlank] = useState<"black" | "white" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Questions waiting for the host's eye, lifted here from QaModeration so
  // the `Moderate` button can carry the count before the panel is open.
  const [qaWaiting, setQaWaiting] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const connection = useConnection();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [viewMode, setViewMode] = useState<"question" | "leaderboard" | "qa">("question");
  const [finalEntries, setFinalEntries] = useState<LeaderboardEntry[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [revealPayload, setRevealPayload] = useState<Record<string, any> | null>(null);
  const [stage, setStageState] = useState<Stage>(getStage);
  // Deck-level look + host-only extras, all delivered on the create-session ack.
  const [deckTheme, setDeckTheme] = useState<string>("floodlight");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [speakerOpen, setSpeakerOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // Which slides this room has actually been shown — the only thing that makes
  // a question a spoiler or not (SlideNavigator.tsx). Accumulated from
  // `slide:changed`, which is the one event that means "the room is now
  // looking at this", and restored on a reload so a refresh does not re-classify
  // twenty minutes of already-asked questions as secrets.
  const [shownIdx, setShownIdx] = useState<Set<number>>(() => new Set());
  const [revealUpcoming, setRevealState] = useState(getRevealUpcoming);

  const joinCodeRef = useRef<string | null>(null);
  const currentSlideIdRef = useRef<string | null>(null);
  const revealBadgeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // StrictMode double-invokes effects in dev; without this we'd silently
  // create two live sessions (and two join codes) per page load.
  const sessionCreatedRef = useRef(false);
  // Has this page ever adopted a session? Decides what a `connect` means: the
  // first one is the bootstrap, every later one is a reconnect that has to
  // re-adopt the room (the server's `socket.data` died with the old id).
  const hasAdoptedRef = useRef(false);

  const goDecks = useCallback(() => navigate("/dashboard"), [navigate]);

  // One spelling of "say it in the bar". Transient unless the notice says
  // otherwise; a sticky one is replaced only by the next sticky one or a
  // dismiss, so a lost keypress cannot paper over "the session is gone".
  const say = useCallback((n: Notice) => {
    setNotice((prev) => (prev?.sticky && !n.sticky ? prev : n));
  }, []);

  useEffect(() => {
    if (!notice || notice.sticky) return;
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!id) return;
    let live = true;
    api
      .getPresentation(id)
      .then((p) => {
        if (live) setDeckTitle(p.title);
      })
      // The title is a courtesy, not a dependency: the session ack is what
      // decides whether this screen works, and it has its own failure path.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);

  // Stage Light is scoped to this element, not <html>, so a participant view
  // open in the same browser stays dark (DESIGN.md §5).
  // The presenter machine is the one that should make noise — it has the
  // speakers the room can hear.
  useEffect(() => {
    initSound({ role: "presenter" });
  }, []);

  // The stage measures its own offset from the server, on the same schedule
  // and through the same filter as every phone in the room. Mounted here
  // rather than inside the big socket effect because it has nothing to do with
  // a session: it is true before a join code exists and stays true across one
  // ending and the next one starting.
  useEffect(() => startClockSync(getSocket()), []);

  useEffect(() => {
    applyStage(stage, rootRef.current);
    // The deck theme is a set of token overrides written on the same element,
    // so it has to be re-applied whenever the stage mood flips.
    applyTheme(rootRef.current, deckTheme, stage);
  }, [stage, deckTheme]);

  useEffect(() => {
    const socket = getSocket();

    // The room roster, reduced in exactly one place. Both the
    // `participant:count` broadcast and the resume ack carry the same two
    // fields with the same element shape (CONTRACT2 §1), so there is one
    // spelling of "who is in the room" and one place to get it wrong.
    // `chime` is the only thing the two callers disagree about.
    function applyParticipants(payload: any, chime: boolean) {
      const next = payload.count ?? payload.participants?.length ?? 0;
      setParticipantCount((prev) => {
        // Only chime on arrivals, never on departures.
        if (chime && next > prev) playSound("join");
        return next;
      });
      setParticipants(payload.participants ?? []);
    }

    // Both acks describe the same thing — a live session this socket now
    // drives — so they're absorbed through one path. They disagree on one
    // field name: create-session says `currentIndex`, resume-session says
    // `index` (CONTRACT §4).
    function adoptSession(res: any) {
      // Before the state that depends on it, as on the phone: this ack is the
      // first thing a resuming host hears, and it may be carrying a slide that
      // is already running.
      noteServerNow(res?.serverNow);
      hasAdoptedRef.current = true;
      setJoinCode(res.joinCode);
      joinCodeRef.current = res.joinCode;
      if (res.pacing === "AUDIENCE" || res.pacing === "PRESENTER") setPacing(res.pacing);
      // The trail back. Written here rather than at the exit, because the
      // exits we care about are the ones we do not control: browser Back, a
      // bookmark, a reload, a host who alt-tabs to the editor in another tab.
      // Adopting a session is the one moment every one of those paths has
      // already passed through (lib/liveSession.ts).
      if (id && res.joinCode) markPresenting(id, res.joinCode, res.currentSlide?.id ?? null);
      // A resume re-enters a room that has a history. Restore what it has been
      // shown, and fold in the slide it is on right now, which is true whether
      // this is a resume or a fresh session that just opened.
      const shown = getShownSlides(res.joinCode);
      const at = res.index ?? res.currentIndex ?? -1;
      if (at >= 0) shown.add(at);
      saveShownSlides(res.joinCode, shown);
      setShownIdx(shown);
      if (res.sessionId) setSessionId(res.sessionId);
      setStatus(res.status);
      setIndex(res.index ?? res.currentIndex ?? -1);
      setTotalSlides(res.totalSlides);
      setCurrentSlide(res.currentSlide ?? null);
      currentSlideIdRef.current = res.currentSlide?.id ?? null;
      // Only present on a resume — a fresh session has no slide running yet,
      // and `undefined` must not be read as "no clock" on the reload path.
      if (res.startedAt !== undefined) setStartedAt(res.startedAt ?? null);
      if (res.timeLimitSec !== undefined) setTimeLimit(res.timeLimitSec ?? null);
      if (res.theme) setDeckTheme(res.theme);
      if (Array.isArray(res.notes)) {
        setNotes(Object.fromEntries(res.notes.map((n: any) => [n.id, n.notes ?? ""])));
      }
      if (Array.isArray(res.slideTitles)) setSlideTitles(res.slideTitles);
      // A resume is a re-join for the host, so the ack carries the same
      // `revealed` / `reveal` pair as participant:join. Without consuming it a
      // reload while sitting on an already-revealed slide drops the projector
      // back to the pre-reveal stage, and nothing corrects it until the host
      // navigates away — the stored frame is only re-emitted by `goto`, which a
      // resume never calls. Absent on create-session, where false is correct.
      //
      // Deliberately silent: no reveal chime, no confetti burst. The room
      // already had that moment; replaying it because the host's browser
      // reloaded would celebrate the same answer twice.
      setRevealed(!!res.revealed);
      setRevealPayload(res.revealed ? (res.reveal ?? {}) : null);
      if (res.reveal?.aggregate) setAggregate(res.reveal.aggregate);

      // R1: the lobby IS the player list, and `participant:count` is emitted
      // only on a join and a disconnect — so a resumed host reads "0 joined /
      // 0 players ready" in front of a room of people who are all still
      // connected, and it does not heal through navigation. That reads as a
      // failed resume, and the rational next move is End or a fresh session —
      // the exact data loss the resume path exists to prevent. The ack now
      // carries the same `count`/`participants` pair as the broadcast
      // (CONTRACT2 §1), fed through the same reducer above.
      //
      // Guarded, not defaulted: create-session omits both because a brand-new
      // room genuinely has nobody in it, and a `?? 0` here would be
      // indistinguishable from the bug. Silent for the same reason as the
      // reveal above — adopting 28 players who never moved is not 28
      // arrivals, so the join chime stays off.
      if (res.count !== undefined || Array.isArray(res.participants)) {
        applyParticipants(res, false);
      }

      // Standings are a broadcast with nothing behind them, so a host who
      // reloaded while the scoreboard was up came back on the slide while
      // every phone in the room was still reading the board — and had to
      // press `l` to rejoin a moment they never actually left. The ack now
      // carries the same `leaderboardView` field, with the same `{ entries }`
      // shape, that participant:join uses (CONTRACT2 §3).
      //
      // `undefined` and `null` are different answers: absent means an older
      // server or create-session, which must not touch the view, while an
      // explicit null is the server saying the board is DOWN. Same rule the
      // participant side applies to this field.
      //
      // The entries go in through the one expression `leaderboard:updated`
      // uses, and we deliberately do NOT call showLeaderboard() — that emits
      // presenter:show-leaderboard, which would re-broadcast the board to a
      // room already looking at it and overwrite the stored frame with a
      // newer one, so the reloading host would hand everyone else a different
      // scoreboard. Silent, like the reveal and roster above: BarRace only
      // celebrates a lead CHANGE (prev !== null), so a first render adopts
      // the standings without re-running the moment.
      if (res.leaderboardView !== undefined) {
        if (res.leaderboardView) {
          setLeaderboard(res.leaderboardView.entries ?? []);
          setViewMode("leaderboard");
        } else {
          setViewMode("question");
        }
      }
    }

    function createSession() {
      // Pre-session, so a refusal here is the one failure allowed to own the
      // screen — and it gets a deadline, because a create that is never
      // answered used to leave a lobby of six dots on the projector forever.
      emitWithAck<any>(socket, "presenter:create-session", { token: getToken(), presentationId: id }, 8000).then(
        (r) => {
          if (!r.ok) {
            setFatal(fatalFor(r.code, r.error));
            return;
          }
          adoptSession(r.res);
        }
      );
    }

    // B5: on reload the host MUST re-attach to the session that already holds
    // the room. Minting a second Session row (a second join code) leaves every
    // phone in the old room ticking toward a reveal nobody can drive, with no
    // way back to the responses. So: resume first, create only when there is
    // genuinely nothing live for this deck + owner (CONTRACT §4).
    function bootstrapSession() {
      // The ack timeout is a floor, not an optimisation — a server build that
      // predates this event never acks at all, and a presenter waiting forever
      // on a silent ack is worse than one that starts a fresh deck. It is armed
      // only once connected, because socket.io starts the timer at emit() even
      // while the packet sits in the send buffer: timing out a handshake rather
      // than a handler would abandon a resumable room on a slow network.
      socket
        .timeout(2500)
        .emit(
          "presenter:resume-session",
          { token: getToken(), presentationId: id },
          (err: any, res: any) => {
            if (!err && res?.ok) {
              adoptSession(res);
              return;
            }
            createSession();
          }
        );
    }

    if (!sessionCreatedRef.current) {
      sessionCreatedRef.current = true;
      // Deliberately NOT removed on cleanup: StrictMode's dev double-invoke
      // unmounts between the two runs, and the ref guard stops the second run
      // from re-registering — dropping it here would leave the deck unstarted.
      if (socket.connected) bootstrapSession();
      else socket.once("connect", bootstrapSession);
    }

    // The presenter's reconnect, which it never had (1.2). Socket.IO comes
    // back under a NEW id with empty `socket.data`: the room would still be
    // running, the answered-counter would freeze, and the next clicker press
    // would be refused as UNAUTHORIZED — silently, before this. The repair is
    // the reload path: resume-session re-attaches this socket and re-pushes
    // the frames a reload would miss. `hasAdoptedRef` keeps the bootstrap's
    // own first `connect` from running it twice.
    function onReconnect() {
      if (!hasAdoptedRef.current) return;
      emitWithAck<any>(socket, "presenter:resume-session", { token: getToken(), presentationId: id }, 6000).then(
        (r) => {
          if (r.ok && r.res?.ok) {
            adoptSession(r.res);
            setNotice((prev) => (prev?.sticky ? prev : { text: "Back online — the room is yours again" }));
            return;
          }
          if (!r.ok) {
            say(noticeFor(r, "Reconnecting", goDecks));
            return;
          }
          // Answered, but with no room to give back: it ended or was reaped
          // while this window was away.
          say(noticeFor({ ok: false, code: "SESSION_GONE", error: "" }, "Reconnecting", goDecks));
        }
      );
    }
    socket.on("connect", onReconnect);

    socket.on("slide:changed", (payload) => {
      // THE STAGE IS A CLIENT TOO.
      //
      // This line is the whole of a bug the room could see and nobody could
      // explain. `TimerRing` counts `serverNow() - startedAt`; `startedAt` is
      // the server's, and `serverNow()` is this machine's clock plus whatever
      // offset the wire has told us. The phones record that offset on every
      // frame. The presenter never recorded it anywhere — so `serverNow()`
      // fell through to `Date.now()` and the projector counted down on the
      // host laptop's own clock while every phone in the room counted down on
      // the server's. A laptop a few seconds out of true put the big screen
      // and the audience on visibly different timers for the entire session,
      // and neither side had any way to tell which one was lying.
      //
      // First, ahead of the state below, for the reason the phone states: the
      // effects that arm the countdown run after this handler returns.
      noteServerNow(payload?.serverNow);
      // Re-learn the deck as the host moves through it. `totalSlides` is
      // authoritative on every frame while `slideTitles` is issued once, so a
      // length disagreement is the only signal we get that the session's
      // snapshot was reconciled under us (a slide deleted from the deck
      // mid-run). When that happens every index below is suspect, so the list
      // drops to numbers and re-learns a title each time the host lands on a
      // slide — a navigator showing confidently WRONG titles is worse than one
      // showing none, because the host jumps on it in front of a room.
      setSlideTitles((prev) => {
        const n = payload.totalSlides ?? prev.length;
        const stale = prev.length !== n;
        const base = stale ? Array.from({ length: n }, () => null) : prev.slice();
        if (payload.currentSlide) base[payload.index] = payload.currentSlide.question;
        // The same staleness signal governs what the room has been SHOWN. If
        // the deck's length moved, every index below means something else now,
        // and a stale "seen" would uncover a question nobody has been asked.
        // The slide on screen is the one thing still certainly true.
        setShownIdx((prevSeen) => {
          const next = stale ? new Set<number>() : new Set(prevSeen);
          next.add(payload.index);
          saveShownSlides(joinCodeRef.current, next);
          return next;
        });
        return base;
      });
      // Keep the trail pointing at what the ROOM is looking at, not merely at
      // which deck is live. A host who ducks into the editor from here is
      // almost always going to fix the thing on the projector, and the editor
      // can only open there if the crumb says where "there" is (FLOW.md F4).
      if (id && joinCodeRef.current) {
        markPresenting(id, joinCodeRef.current, payload.currentSlide?.id ?? null);
      }
      setIndex(payload.index);
      setStatus(payload.status);
      setCurrentSlide(payload.currentSlide);
      currentSlideIdRef.current = payload.currentSlide?.id ?? null;
      setTotalSlides(payload.totalSlides);
      setStartedAt(payload.startedAt ?? null);
      setTimeLimit(payload.timeLimitSec ?? null);
      setAggregate(null);
      setViewMode("question");
      setRevealed(false);
      setRevealPayload(null);
    });

    socket.on("results:updated", (payload) => {
      // Ignore results for a slide we've navigated away from — a late
      // broadcast shouldn't flash stale data onto the big screen.
      if (payload.slideId === currentSlideIdRef.current) setAggregate(payload.aggregate);
    });

    socket.on("participant:count", (payload) => applyParticipants(payload, true));

    socket.on("leaderboard:updated", (payload) => setLeaderboard(payload.entries ?? []));

    socket.on("slide:reveal", (payload) => {
      noteServerNow(payload?.serverNow);
      if (payload.slideId === currentSlideIdRef.current) {
        setRevealed(true);
        setRevealPayload(payload ?? {});
        if (payload.aggregate) setAggregate(payload.aggregate);
        playSound("reveal");
        window.setTimeout(() => burstFrom(revealBadgeRef.current, 60), 160);
      }
    });

    return () => {
      socket.off("slide:changed");
      socket.off("results:updated");
      socket.off("participant:count");
      socket.off("leaderboard:updated");
      socket.off("slide:reveal");
      socket.off("connect", onReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // The waiting count for the `Moderate` badge (6.8). Same seed-then-subscribe
  // shape as QaModeration, which also listens — off by handler reference so
  // the two never unhook each other.
  useEffect(() => {
    if (!joinCode) return;
    const socket = getSocket();
    let live = true;
    const count = (qs: any[] | undefined) =>
      setQaWaiting((qs ?? []).filter((q) => q?.status === "PENDING").length);
    const onUpdated = (payload: { questions?: any[] }) => count(payload?.questions);
    socket.emit("qa:list", { joinCode }, (res: any) => {
      if (live && res?.ok) count(res.questions);
    });
    socket.on("qa:updated", onUpdated);
    return () => {
      live = false;
      socket.off("qa:updated", onUpdated);
    };
  }, [joinCode]);

  // Every host command through one door: ack, deadline, and a sentence in the
  // bar when it did not land (PULSE.md T2 — "fire-and-forget is forbidden").
  // The optimistic local change the caller already made stands; the server's
  // own broadcast reconciles it when the command does land.
  const command = useCallback(
    (event: string, verb: string, extra: Record<string, unknown> = {}) =>
      emitWithAck<any>(getSocket(), event, { joinCode: joinCodeRef.current, token: getToken(), ...extra }).then((r) => {
        if (!r.ok) say(noticeFor(r, verb, goDecks));
        return r;
      }),
    [say, goDecks]
  );

  // "Is this a scored, timed slide?" is now a property of the slide's config,
  // not of its type — several types can be quiz-capable.
  const isCurrentQuiz = !!currentSlide?.config?.isQuiz;

  const showLeaderboard = useCallback(() => {
    setViewMode("leaderboard");
    command("presenter:show-leaderboard", "Standings").then((r) => {
      // The stage flipped before the round trip (T1); a board the room never
      // received must not stay up on the one screen that did not need the
      // network to show it.
      if (!r.ok) setViewMode((v) => (v === "leaderboard" ? "question" : v));
    });
  }, [command]);

  const hideLeaderboard = useCallback(() => {
    setViewMode("question");
    command("presenter:hide-leaderboard", "Hiding standings");
  }, [command]);

  // m4: the standings interstitial is only worth a press when there is a
  // scoreboard behind it. Routing a skipped/unanswered quiz slide through it
  // puts a blank 1920×1080 stage reading "No scores yet" in front of the room,
  // and the host has to press again to escape it.
  const showsStandingsNext = isCurrentQuiz && viewMode === "question" && leaderboard.length > 0;

  const next = useCallback(() => {
    // The first "next" after a quiz question shows the leaderboard rather than
    // advancing — the shared scoreboard moment. Press again to move on.
    if (showsStandingsNext) {
      showLeaderboard();
      return;
    }
    // m2: the last-slide guard belongs HERE, not on the button. A lectern
    // clicker sends ArrowRight straight into the keydown handler, which never
    // sees the button's `disabled` attribute — and re-firing the final slide
    // re-broadcasts it with a fresh startedAt, visibly resetting the room's
    // clock on a question that is already over.
    if (index >= totalSlides - 1) return;
    setViewMode("question");
    command("presenter:next", "Next");
  }, [showsStandingsNext, showLeaderboard, index, totalSlides, command]);

  const prev = useCallback(() => {
    if (viewMode === "leaderboard") {
      hideLeaderboard();
      return;
    }
    // The mirror of the guard above: ← at slide 0 reaches here from the clicker
    // without passing the disabled button, and a -1 index means "back to the
    // lobby", which snaps every phone out of the running session (M5).
    if (index <= 0) return;
    command("presenter:prev", "Back");
  }, [viewMode, hideLeaderboard, index, command]);

  // One frame, where stepping there was N. `presenter:goto` runs the same
  // validated nav chain as next/prev (including deleted-slide reconciliation),
  // and it is what `start()` has always used to open the deck at index 0 — so
  // this is not a new path through the server, it is the existing one finally
  // given a surface.
  const jumpTo = useCallback(
    (target: number) => {
      setNavOpen(false);
      setViewMode("question");
      command("presenter:goto", `Slide ${target + 1}`, { index: target });
    },
    [command]
  );

  const start = useCallback(() => {
    command("presenter:goto", "Start", { index: 0 });
  }, [command]);

  // Home/End (1.5): the same `goto` the navigator uses, so a deleted slide is
  // reconciled on the way exactly as it would be from a click.
  const first = useCallback(() => {
    if (totalSlides > 0) jumpTo(0);
  }, [totalSlides, jumpTo]);
  const last = useCallback(() => {
    if (totalSlides > 0) jumpTo(totalSlides - 1);
  }, [totalSlides, jumpTo]);

  function endSession() {
    command("presenter:end", "End").then((r) => {
      // A refused End is the one refusal that must not fall through to the
      // podium: the room is still running, and showing final results over a
      // live session would be rendering a success we cannot prove (T2). The
      // bar has already said why.
      if (!r.ok) return;
      // The room is gone, so the trail back to it must go too — otherwise the
      // editor greets the host with "you're presenting this deck" pointing at
      // a session that just died. LiveRoomBar re-checks with the server and
      // would stay silent anyway; clearing here saves it the round trip and
      // keeps the crumb honest.
      clearPresenting();
      // ...and leave a pointer to what it WAS, so the dashboard can offer the
      // results of the run the host just finished instead of making them go
      // and find it (FLOW.md F6).
      if (id && sessionId && joinCodeRef.current) {
        markRunFinished(id, sessionId, joinCodeRef.current);
      }
      setFinalEntries(r.res?.entries ?? []);
    });
  }

  // Busy while it runs, and a sentence when it fails (6.6) — the same shape
  // the last-run bar and the history page give the same file. The failure
  // lands in the bar on the live stage and under the button on the final
  // screen, which is wherever the host pressed.
  const [exportError, setExportError] = useState<string | null>(null);
  async function exportCsv() {
    if (!sessionId || exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    try {
      await downloadSessionCsv(sessionId, joinCode);
    } catch (e: unknown) {
      const text = e instanceof Error ? e.message : "Export failed.";
      setExportError(text);
      say({ text: `Download didn't start — ${text}`, warn: true });
    } finally {
      setExportBusy(false);
    }
  }

  function toggleStage() {
    const nextStage: Stage = stage === "dark" ? "light" : "dark";
    setStage(nextStage);
    setStageState(nextStage);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.();
  }

  // Presenting is a keyboard-driven activity — the host is standing at a lectern
  // with a clicker that sends arrow keys.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A browser chord is never a room command (1.4). ⌘F dropped fullscreen
      // and ⌘L — focusing the address bar — broadcast the leaderboard to
      // every phone mid-question, because the handler only read `key`.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Letters are case-folded so Caps Lock does not silently disarm the
      // clicker shortcuts; `?` and the named keys pass through untouched.
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (sheetOpen) {
        if (k === "?" || k === "Escape") {
          e.preventDefault();
          setSheetOpen(false);
        }
        return;
      }
      // While the navigator is open the arrows belong to IT. Without this,
      // browsing the map with the keyboard would also be driving the room:
      // ArrowRight here is `presenter:next`, a broadcast to every phone.
      if (navOpen) {
        if (k === "g") {
          e.preventDefault();
          setNavOpen(false);
        }
        return;
      }
      if (k === "?") {
        e.preventDefault();
        setSheetOpen(true);
        return;
      }
      // Blanking (1.5). B and W each toggle their own colour and switch from
      // the other; Escape clears either. Transport keys do NOT unblank — and
      // while the screen is blank they do not drive the room either, because
      // a host who took the stage down is not expecting the phones to move,
      // and a clicker press they cannot see the effect of is a press they
      // will make twice. The bar stays awake and says so (ControlBar `hold`).
      if (k === "b") {
        e.preventDefault();
        setBlank((v) => (v === "black" ? null : "black"));
        return;
      }
      if (k === "w") {
        e.preventDefault();
        setBlank((v) => (v === "white" ? null : "white"));
        return;
      }
      if (k === "Escape") {
        if (blank) {
          e.preventDefault();
          setBlank(null);
        }
        return;
      }
      if (k === "f") {
        toggleFullscreen();
        return;
      }
      if (k === "g") {
        e.preventDefault();
        if (totalSlides > 0) setNavOpen(true);
        return;
      }
      if (blank) return;
      if (k === "ArrowRight" || k === " " || k === "PageDown") {
        e.preventDefault();
        if (status === "LOBBY") start();
        else next();
      } else if (k === "ArrowLeft" || k === "PageUp") {
        e.preventDefault();
        prev();
      } else if (k === "Home") {
        e.preventDefault();
        first();
      } else if (k === "End") {
        e.preventDefault();
        last();
      } else if (k === "l") {
        if (viewMode === "leaderboard") hideLeaderboard();
        else showLeaderboard();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, next, prev, first, last, start, viewMode, showLeaderboard, hideLeaderboard, navOpen, totalSlides, sheetOpen, blank]);

  // What each slide is called, for the jump navigator. Nullable per entry,
  // because "we no longer know" is a state this has to be able to express:
  // the titles arrive once on the session ack and nothing re-issues them, so
  // a slide added or deleted mid-session silently invalidates the list.
  const [slideTitles, setSlideTitles] = useState<(string | null)[]>([]);
  // Built from `totalSlides`, never from the title array's length: the count
  // is authoritative on every frame and the titles are not, so the navigator
  // always offers exactly the slides that exist even when it cannot name them.
  //
  // Memoised because it is a dependency of the speaker-window effect, and a
  // fresh array identity every render would re-write that window on every
  // answer that streams in.
  // `seen` rides along rather than being resolved here, because the two
  // consumers disagree about it on purpose: the stage navigator honours it,
  // and the speaker window ignores it. The titles themselves are never
  // stripped — masking is a rendering decision made by the surface that is
  // actually being projected, not a fact about the data.
  const navSlides = useMemo(
    () =>
      Array.from({ length: totalSlides }, (_, i) => {
        return { index: i, title: slideTitles[i] ?? null, seen: shownIdx.has(i) };
      }),
    [totalSlides, slideTitles, shownIdx]
  );

  // Where phones should point. Null until resolved; falls back to this page's
  // own origin, which is correct whenever the host is not on localhost.
  const [joinOrigin, setJoinOrigin] = useState<string | null>(null);

  useEffect(() => {
    resolveJoinOrigin().then(setJoinOrigin);
  }, []);

  // What the speaker window's keys do (1.8). From the lobby, "next" is Start,
  // exactly as on the stage's own handler.
  const speakerTransport = useMemo<SpeakerTransport>(
    () => ({
      next: () => (status === "LOBBY" ? start() : next()),
      prev,
      first,
      last,
    }),
    [status, start, next, prev, first, last]
  );

  // Mirror the live state into the speaker window whenever anything it shows
  // changes. Cheap text writes, so no need to be clever about diffing.
  useEffect(() => {
    if (!speakerOpen) return;
    if (!speakerWindowOpen()) {
      setSpeakerOpen(false);
      return;
    }
    updateSpeakerWindow({
      index,
      total: totalSlides,
      question: currentSlide?.question ?? "",
      notes: currentSlide ? (notes[currentSlide.id] ?? "") : "",
      nextQuestion: slideTitles[index + 1] ?? null,
      participants: participantCount,
      answered: aggregate?.total ?? 0,
      // The clock the room sees, or none: the same gate the stage ring uses.
      startedAt: isCurrentQuiz && !revealed && status === "ACTIVE" ? startedAt : null,
      timeLimitSec: timeLimit ?? currentSlide?.config?.timeLimitSec ?? null,
      selfPaced: pacing === "AUDIENCE" && status === "ACTIVE",
      // The same deck the stage navigator offers, on the one surface the
      // projector never shows. A host with a second screen never has to put
      // the upcoming questions on the wall to find one.
      slides: navSlides,
      onJump: jumpTo,
      transport: speakerTransport,
    });
  }, [
    speakerOpen,
    index,
    totalSlides,
    currentSlide,
    notes,
    slideTitles,
    participantCount,
    aggregate,
    navSlides,
    jumpTo,
    startedAt,
    timeLimit,
    isCurrentQuiz,
    revealed,
    status,
    pacing,
    speakerTransport,
  ]);

  useEffect(() => () => closeSpeakerWindow(), []);

  const origin = joinOrigin ?? window.location.origin;
  const joinUrl = joinCode ? `${origin}${window.location.pathname}#/join/${joinCode}` : "";
  // Only a problem if we are on localhost AND could not find a LAN address.
  const unreachable = isLoopbackHost() && !joinOrigin;
  // The button mirrors what next() will actually do — it is no longer the only
  // thing holding the last-slide guard (m2), and it must not stay enabled for a
  // standings moment that next() now skips (m4).
  const nextDisabled = !showsStandingsNext && index >= totalSlides - 1;
  const responses = aggregate?.total ?? 0;

  // Pre-session only (1.1). Stage ladder, because a projector may already be
  // showing this; a reason, because a bare string was not one; and a door,
  // because a screen with no way out in fullscreen is a wall.
  if (fatal) {
    return (
      <div ref={rootRef} className="h-[100dvh] flex flex-col items-center justify-center gap-8 px-stage-safe bg-canvas text-ink overflow-hidden">
        <StageBloom />
        <p className="relative z-10 text-stage-label font-semibold uppercase track-label text-ink-subtle">
          {deckTitle ?? "Present"}
        </p>
        <h1 className="relative z-10 font-display text-stage-q-sm font-bold text-center balance max-w-[24ch]">
          {fatal.title}
        </h1>
        <p className="relative z-10 text-stage-name text-ink-muted text-center max-w-[40ch]">{fatal.detail}</p>
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-3">
          <Button variant="secondary" size="xl" className="text-stage-label" onClick={goDecks}>
            ← Decks
          </Button>
          {fatal.editDoor && (
            <Button variant="primary" size="xl" className="text-stage-label" onClick={() => navigate(`/edit/${id}`)}>
              Edit deck
            </Button>
          )}
          {fatal.retry && (
            <Button variant="primary" size="xl" className="text-stage-label" onClick={() => window.location.reload()}>
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (finalEntries) {
    return (
      <div ref={rootRef} className="contents">
        <FinalResults
          entries={finalEntries}
          canExport={!!sessionId}
          exportBusy={exportBusy}
          exportError={exportError}
          onExport={exportCsv}
          onAgain={() => {
            // A finished session cannot be revived, so "again" means a new
            // one — and a new one must be minted by the same hard-won path a
            // cold load takes (resume-session first, create only if nothing
            // is live). Reloading this route runs that path exactly as
            // written instead of growing a second spelling of it beside it.
            window.location.reload();
          }}
          onEdit={() => navigate(`/edit/${id}`)}
          onBack={goDecks}
        />
      </div>
    );
  }

  // What the bar says when the wire is the news. Only while something is
  // wrong — a permanent indicator trains the host to ignore the one moment it
  // matters (ConnectionBanner.tsx). It outranks any other notice: nothing a
  // refused press can say matters more than "the room cannot hear you".
  const connectionNotice: Notice | null =
    connection.status === "offline"
      ? { text: "Offline — the room can't hear you. Reconnecting…", warn: true, sticky: true }
      : connection.status === "reconnecting"
        ? { text: "Reconnecting…", warn: true, sticky: true }
        : connection.status === "connecting"
          ? { text: "Connecting…", warn: true, sticky: true }
          : null;
  const blankNotice: Notice | null = blank
    ? { text: "Screen blanked — press B or Esc to resume. Slide keys are paused.", sticky: true }
    : null;
  const barNotice = connectionNotice ?? notice ?? blankNotice;

  return (
    <div ref={rootRef} className="h-[100dvh] flex flex-col bg-canvas text-ink overflow-hidden">
      <StageBloom />
      <ReactionOverlay joinCode={joinCode ?? ""} />

      {qaOpen && joinCode && (
        <aside className="absolute top-0 right-0 z-40 h-full w-[380px] max-w-[90vw] bg-surface-1 border-l border-hairline overflow-y-auto p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-body">Audience questions</h2>
            <Button variant="ghost" size="sm" onClick={() => setQaOpen(false)}>
              Close
            </Button>
          </div>
          <QaModeration joinCode={joinCode} />
        </aside>
      )}

      {/* Header and stage share one box so the blank overlay can cover exactly
          them and never the footer beneath (1.5). */}
      <div className="relative flex-1 min-h-0 flex flex-col">
      {/* The blank screen (1.5): a real element over the projected stage and
          nothing else — the footer stays reachable and readable, which is
          where the host is told how to get the stage back. Pure black and
          pure white rather than tokens, because the projector is being asked
          for nothing, not for a dark surface. */}
      {blank && (
        <div
          aria-hidden="true"
          data-blank={blank}
          className="absolute inset-0 z-30"
          style={{ background: blank === "black" ? "#000" : "#fff" }}
        />
      )}

      {/* ── status strip. Nothing here is below 18px; it sits inside the
          safe area because projectors crop the edges. ───────────────── */}
      <header className="relative z-20 shrink-0 flex items-center justify-between px-stage-safe pt-6 pb-2">
        <span className="flex items-center gap-2.5 text-stage-label font-semibold text-ink-muted">
          <i className="w-2.5 h-2.5 rounded-pill bg-accent animate-pulse" />
          <span className="nums">
            <NumberTicker value={participantCount} />
          </span>
          <span className="text-ink-muted">joined</span>
        </span>

        {/* Where you are, and in WHICH deck (1.7). The title is sentence case
            beside an uppercase position so the two read as name · place,
            not as one long label; it truncates rather than wraps because a
            status strip that grows a second line moves the stage under it. */}
        <span className="flex items-center gap-3 min-w-0 text-stage-label font-semibold text-ink-muted">
          {deckTitle && (
            <>
              <span className="truncate max-w-[36vw]">{deckTitle}</span>
              <span aria-hidden="true" className="text-ink-subtle">
                ·
              </span>
            </>
          )}
          <span className="uppercase track-label shrink-0">
            {status === "LOBBY"
              ? "Lobby"
              : viewMode === "leaderboard"
                ? "Standings"
                : `${index + 1} / ${totalSlides}`}
          </span>
          {pacing === "AUDIENCE" && (
            <span className="uppercase track-label shrink-0 text-ink-subtle">Self-paced</span>
          )}
        </span>

        <span className="flex items-center gap-3">
          {status !== "LOBBY" && aggregate && (
            <span className="text-stage-label font-semibold text-ink-muted">
              <span className="nums text-ink">
                <NumberTicker value={responses} />
              </span>{" "}
              <span className="text-ink-muted">answered</span>
            </span>
          )}
        </span>
      </header>

      <main className="relative z-10 flex-1 min-h-0 flex flex-col px-stage-safe pb-2">
        <AnimatePresence mode="wait">
          {status === "LOBBY" ? (
            <LobbyStage
              key="lobby"
              joinCode={joinCode}
              joinUrl={joinUrl}
              joinOrigin={origin}
              unreachable={unreachable}
              participants={participants}
              participantCount={participantCount}
            />
          ) : viewMode === "qa" ? (
            <motion.section
              key="qa"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32 }}
              className="flex-1 min-h-0 flex flex-col justify-center py-4"
            >
              <QaStage joinCode={joinCode ?? ""} />
            </motion.section>
          ) : viewMode === "leaderboard" ? (
            <motion.section
              key="leaderboard"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32 }}
              className="flex-1 min-h-0 flex flex-col justify-center gap-8 py-4"
            >
              <h2 className="font-display text-stage-q font-bold text-center leading-none">
                Standings
              </h2>
              {/* Five rows only — past row 5 nothing is readable at 15ft.
               *
               * But the whole board goes IN. Slicing here was slicing the
               * race's memory as well as its canvas: the component remembers
               * what it last rendered, so a top-5 slice meant a player
               * arriving from sixth had no remembered score and therefore no
               * movement — the single most dramatic climb on the board was
               * the one case that did not animate. `visibleRows` draws five
               * and races all ten, so sixth-to-first crosses the cut line on
               * the frame it earns. (Eleventh-to-first still cannot move:
               * `computeLeaderboard` sends a top ten and we never had those
               * rows. That is a wire limit, not a rendering one.) */}
              <BarRaceLeaderboard
                entries={leaderboard}
                visibleRows={5}
                // Scoped to the SESSION, not the surface. A constant key here
                // meant the component's remembered board outlived the game it
                // came from: end a session, start another on the same deck in
                // the same tab, and the new game's first standings opened in
                // the dead game's scores with the bars off the side of the
                // screen. `sessionId` is the right grain — a join code can in
                // principle come round again, a session id cannot.
                raceKey={`stage:${sessionId ?? joinCode ?? ""}`}
                celebrateLeader
                stage
              />
            </motion.section>
          ) : (
            <QuestionStage
              key={currentSlide?.id ?? "q"}
              slide={currentSlide}
              aggregate={aggregate}
              startedAt={startedAt}
              isQuiz={isCurrentQuiz}
              revealed={revealed}
              revealPayload={revealPayload}
              revealBadgeRef={revealBadgeRef}
              timeLimit={timeLimit}
              selfPaced={pacing === "AUDIENCE"}
              answered={responses}
            />
          )}
        </AnimatePresence>
      </main>
      </div>

      <ControlBar
        status={status}
        stage={stage}
        // The room survives this: the server holds the session and
        // presenter:resume-session re-attaches when the host comes back. The
        // editor shows a LiveRoomBar for exactly this crumb, so the door is
        // visible from both sides.
        onEditDeck={() => navigate(`/edit/${id}`)}
        notice={barNotice}
        // The connection and the blank screen clear themselves; only a
        // notice the host was handed is theirs to dismiss.
        onDismissNotice={barNotice === notice ? () => setNotice(null) : undefined}
        // The bar's auto-hide is paused whenever there is something on it the
        // host has to be able to read or is in the middle of using.
        hold={!!barNotice || navOpen || sheetOpen || qaOpen}
        selfPaced={pacing === "AUDIENCE"}
        qaWaiting={qaWaiting}
        exportBusy={exportBusy}
        blank={blank}
        onToggleBlank={() => setBlank((v) => (v ? null : "black"))}
        sheetOpen={sheetOpen}
        onToggleSheet={() => setSheetOpen((v) => !v)}
        slides={navSlides}
        currentIndex={index}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onJump={jumpTo}
        revealUpcoming={revealUpcoming}
        onToggleReveal={() => {
          const next = !revealUpcoming;
          setRevealState(next);
          setRevealUpcoming(next);
        }}
        onToggleStage={toggleStage}
        onFullscreen={toggleFullscreen}
        onStart={start}
        onPrev={prev}
        onNext={next}
        prevDisabled={index <= 0 && viewMode === "question"}
        nextDisabled={nextDisabled}
        nextLabel={showsStandingsNext ? "Standings" : "Next"}
        canStart={totalSlides > 0}
        hasScores={leaderboard.length > 0}
        leaderboardOpen={viewMode === "leaderboard"}
        onToggleLeaderboard={() =>
          viewMode === "leaderboard" ? hideLeaderboard() : showLeaderboard()
        }
        onExport={exportCsv}
        onEnd={endSession}
        qaStageOpen={viewMode === "qa"}
        onToggleQaStage={() => setViewMode((v) => (v === "qa" ? "question" : "qa"))}
        onOpenQaPanel={() => setQaOpen(true)}
        speakerOpen={speakerOpen}
        onToggleSpeaker={() => {
          if (speakerOpen) {
            closeSpeakerWindow();
            setSpeakerOpen(false);
          } else if (openSpeakerWindow()) {
            setSpeakerOpen(true);
          } else {
            // Popup blocked — say so in the bar rather than leaving a dead
            // button. This used to replace the entire presenter view with one
            // line of text, mid-session, in front of the room (1.1).
            say({ text: "Allow pop-ups for this site to open the speaker view", warn: true });
          }
        }}
      />
    </div>
  );
}

// One atmospheric wash on the canvas layer. A gradient is a room, not a
// decoration — it never touches type (DESIGN.md P2).
function StageBloom() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        background:
          "radial-gradient(1200px 680px at 12% -14%, var(--accent-a18) 0%, transparent 56%)," +
          "radial-gradient(1000px 760px at 108% 110%, color-mix(in oklch, var(--ans-a), transparent 86%) 0%, transparent 52%)",
      }}
    />
  );
}

// ── Lobby: the screen that is projected longest, and the one every
// competitor wastes (DESIGN.md §5). Join code is the hero. ─────────────
function LobbyStage({
  joinCode,
  joinUrl,
  joinOrigin,
  unreachable,
  participants,
  participantCount,
}: {
  joinCode: string | null;
  joinUrl: string;
  joinOrigin: string;
  unreachable: boolean;
  participants: Participant[];
  participantCount: number;
}) {
  const stageK = useStageScale();
  // Show the address phones must type, which is not necessarily this page's.
  const host = `${joinOrigin.replace(/^https?:\/\//, "")}${window.location.pathname}#/join`;
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_auto] gap-stage-gap items-stretch py-2"
    >
      <div className="min-w-0 flex flex-col h-full gap-1 py-2">
        <p className="text-stage-label font-semibold text-ink-subtle">
          <span className="uppercase track-label">Join at</span>{" "}
          <span className="text-ink font-mono">{host}</span>
        </p>
        {unreachable && (
          <p className="text-stage-label font-semibold text-warn max-w-[40ch]">
            This machine has no network address — phones can't reach this link.
            Connect to Wi-Fi, then reload.
          </p>
        )}
        <p
          className="code font-bold text-stage-code leading-none text-accent"
          aria-label={`Join code ${joinCode?.split("").join(" ")}`}
        >
          {joinCode ?? "······"}
        </p>

        <div className="flex-1 min-h-0 -mx-4">
          <PlayerBubbles participants={participants} />
        </div>

        <p className="shrink-0 text-stage-name font-semibold text-ink-muted">
          <span className="nums text-ink">
            <NumberTicker value={participantCount} />
          </span>{" "}
          {participantCount === 1 ? "player" : "players"} ready
        </p>
      </div>

      {/* QR stays pure black-on-white in BOTH stage themes — scanner contrast
       * is a hardware requirement, not a style choice. */}
      <div className="shrink-0 self-center flex flex-col items-center gap-3">
        <div className="bg-white p-5 rounded-xl" style={{ lineHeight: 0 }}>
          {joinUrl && (
            <QRCodeSVG
              value={joinUrl}
              // The room contract floors this at 220px because it is a scanner
              // target, not a graphic; on a bigger stage the people furthest
              // from it are further away, so it rides the anchor too.
              size={Math.round(260 * stageK)}
              level="M"
              bgColor="#ffffff"
              fgColor="#000000"
            />
          )}
        </div>
        <p className="text-stage-label font-semibold uppercase track-label text-ink-subtle">
          or scan
        </p>
      </div>
    </motion.section>
  );
}

function QuestionStage({
  slide,
  aggregate,
  startedAt,
  isQuiz,
  revealed,
  revealPayload,
  revealBadgeRef,
  timeLimit,
  selfPaced,
  answered,
}: {
  slide: CurrentSlide | null;
  aggregate: any;
  startedAt: number | null;
  timeLimit: number | null;
  isQuiz: boolean;
  revealed: boolean;
  revealPayload: Record<string, any> | null;
  revealBadgeRef: React.RefObject<HTMLDivElement | null>;
  /**
   * AUDIENCE pacing (1.3): the server arms no reveal for a self-paced deck, so
   * a ring here would count down to nothing — suspense theatre the phone was
   * already spared (FLOW.md §6.3). The slot carries the honest line instead.
   */
  selfPaced: boolean;
  answered: number;
}) {
  // Before the early return: a hook may not sit behind a condition.
  const stageK = useStageScale();
  if (!slide) return null;
  const def = slideType(slide.type);
  if (!def) return null;
  const StageView = def.Stage;
  const isContent = !def.interactive;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.32, ease: [0, 0, 0.2, 1] }}
      // No ceiling on either of these (see tailwind.config.js, the stage
      // ladder): the headline box capped at 280px from 1555px of height up, so
      // on a 4K stage FitText was searching down into a box barely half the
      // one 1080p gets while the ladder around it had doubled. Both are plain
      // vh with a floor now, which is what they always meant.
      className="flex-1 min-h-0 flex flex-col justify-center gap-[max(20px,4vh)] py-2"
    >
      {/* Content slides render edge to edge: the module draws its own heading,
          so a separate question line above it would just duplicate it. */}
      {!isContent && (
        <div className="shrink-0 flex items-center gap-stage-gap h-[max(120px,24vh)]">
          <div className="flex-1 min-w-0 h-full">
            {/* Condenses before it shrinks, so a long question stays readable
                from the back of the room. */}
            {/* `max`/`min` are design-size px and ride the stage anchor
                from there (FitText). */}
            <FitText max={104} min={34}>
              {slide.question}
            </FitText>
          </div>
          {isQuiz && !revealed && selfPaced && (
            <p className="shrink-0 self-center text-right text-stage-label font-semibold text-ink-muted max-w-[22ch]">
              Everyone at their own pace
              <br />
              <span className="nums text-ink">
                <NumberTicker value={answered} />
              </span>{" "}
              answered
            </p>
          )}
          {isQuiz && !revealed && !selfPaced && (
            <TimerRing
              key={slide.id}
              startedAt={startedAt}
              timeLimitSec={timeLimit ?? slide.config?.timeLimitSec ?? 20}
              // Design-size px, scaled on the same anchor as the type beside
              // it. A 140px ring held its size while the question doubled.
              size={Math.round(140 * stageK)}
              stroke={Math.round(14 * stageK)}
              className="shrink-0"
            />
          )}
          {revealed && (
            <div
              ref={revealBadgeRef}
              className="shrink-0 self-center flex items-center gap-2.5 rounded-pill bg-accent text-accent-ink px-6 py-3 text-stage-label font-bold animate-pop-in"
            >
              Answer
            </div>
          )}
        </div>
      )}

      <div className={isContent ? "flex-1 min-h-0 flex items-center" : "shrink-0 flex items-center"}>
        <div className={isContent ? "w-full h-full" : "w-full"}>
          <StageView
            slide={slide}
            aggregate={aggregate}
            revealed={revealed}
            reveal={revealPayload}
          />
        </div>
      </div>
    </motion.section>
  );
}

// The one place glassmorphism is allowed in the product: a floating control
// bar that is not content and that the audience is not reading (DESIGN.md §7).
// Auto-hides so it isn't burned into the projection.
// The settings cluster, assembled here rather than at the call site because
// every switch it contains is already wired to a handler on this component —
// passing five callbacks up and a list back down would be the same decision
// made twice.
function useSettingsActions(props: {
  stage: Stage;
  onToggleStage: () => void;
  onFullscreen: () => void;
  speakerOpen: boolean;
  onToggleSpeaker: () => void;
  onExport: () => void;
  exportBusy: boolean;
  blank: "black" | "white" | null;
  onToggleBlank: () => void;
  onToggleSheet: () => void;
  onEditDeck: () => void;
}): MoreAction[] {
  // The mute flag lives in lib/sound, not in React, and can be changed from
  // another surface — so it is subscribed to rather than mirrored.
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => true);
  return [
    {
      label: "Speaker notes",
      detail: props.speakerOpen ? "Open" : "Closed",
      checked: props.speakerOpen,
      onSelect: props.onToggleSpeaker,
    },
    {
      // Named for the setting, not the action. As a bar button "Bright room"
      // was right — a button says what pressing it does. In a menu where every
      // other row is `noun → current value`, an action label beside a value
      // fights itself: "Bright room … Dim" reads as two claims about one row.
      // The old spelling is gone rather than duplicated, so this is one name,
      // not a synonym (DESIGN.md P1).
      //
      // `checked` so the row keeps the menu open like its neighbours (6.5):
      // the setting most likely to be flipped twice was the one that ejected
      // you. It is a toggle, and the menu's rule is that toggles stay.
      label: "Room lighting",
      detail: props.stage === "dark" ? "Dim" : "Bright",
      checked: props.stage === "light",
      onSelect: props.onToggleStage,
    },
    {
      label: "Blank screen",
      detail: props.blank ? "On" : "Off",
      checked: !!props.blank,
      onSelect: props.onToggleBlank,
    },
    { label: "Fullscreen", onSelect: props.onFullscreen },
    {
      label: "Sound",
      detail: muted ? "Off" : "On",
      checked: !muted,
      onSelect: () => {
        // Prime the audio context from this gesture. Browsers only allow one
        // to start inside a user interaction, so unmuting and then waiting for
        // some later click swallows the next cue.
        unlockAudio();
        toggleMuted();
      },
    },
    { label: "Keyboard shortcuts", detail: "?", onSelect: props.onToggleSheet },
    // The way OUT without ending. It was first in the bar — the cheapest
    // position, spent on a twice-a-session verb (6.4). The room survives it:
    // the editor shows a LiveRoomBar for the crumb this page writes.
    { label: "Edit deck", detail: "Room stays open", onSelect: props.onEditDeck },
    // One name for one file, product-wide: the final-results screen and the
    // deck list both call this "Download results".
    { label: "Download results", detail: props.exportBusy ? "Preparing…" : undefined, onSelect: props.onExport },
  ];
}

function ControlBar(props: {
  status: string;
  stage: Stage;
  onEditDeck: () => void;
  /** What the bar has to say that is not a button (FooterNotice). */
  notice: Notice | null;
  onDismissNotice?: () => void;
  /** Keep the bar awake: something on it must stay readable or usable. */
  hold: boolean;
  selfPaced: boolean;
  qaWaiting: number;
  exportBusy: boolean;
  blank: "black" | "white" | null;
  onToggleBlank: () => void;
  sheetOpen: boolean;
  onToggleSheet: () => void;
  slides: { index: number; title: string | null; seen: boolean }[];
  currentIndex: number;
  navOpen: boolean;
  onToggleNav: () => void;
  onJump: (index: number) => void;
  revealUpcoming: boolean;
  onToggleReveal: () => void;
  onToggleStage: () => void;
  onFullscreen: () => void;
  onStart: () => void;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
  nextLabel: string;
  canStart: boolean;
  hasScores: boolean;
  leaderboardOpen: boolean;
  onToggleLeaderboard: () => void;
  onExport: () => void;
  onEnd: () => void;
  qaStageOpen: boolean;
  onToggleQaStage: () => void;
  onOpenQaPanel: () => void;
  speakerOpen: boolean;
  onToggleSpeaker: () => void;
}) {
  const moreActions = useSettingsActions(props);
  const [visible, setVisible] = useState(true);
  const timer = useRef<number | null>(null);
  // Is the pointer inside the bar's band? A bar that fades under a hovering
  // cursor moves the target the hand is already over (6.3, Fitts).
  const hovering = useRef(false);
  const holdRef = useRef(props.hold);
  holdRef.current = props.hold;

  useEffect(() => {
    const arm = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        // Not yet: re-arm rather than hide, and ask again in three seconds.
        if (hovering.current || holdRef.current) arm();
        else setVisible(false);
      }, 3000);
    };
    const wake = () => {
      setVisible(true);
      arm();
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  // Something to say wakes the bar on its own — a notice nobody can see is
  // silence with extra steps (PULSE.md T2).
  useEffect(() => {
    if (props.hold) setVisible(true);
  }, [props.hold, props.notice]);

  const inLobby = props.status === "LOBBY";

  return (
    <motion.footer
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 16 }}
      transition={{ duration: 0.22 }}
      onPointerEnter={() => {
        hovering.current = true;
      }}
      onPointerLeave={() => {
        hovering.current = false;
      }}
      className="relative z-30 shrink-0 flex flex-col items-center gap-2 pb-5 pt-1"
    >
      <AnimatePresence>
        {props.navOpen && (
          <SlideNavigator
            slides={props.slides}
            currentIndex={props.currentIndex}
            revealUpcoming={props.revealUpcoming}
            onToggleReveal={props.onToggleReveal}
            onJump={props.onJump}
            onClose={props.onToggleNav}
          />
        )}
        {props.sheetOpen && <ShortcutSheet key="sheet" onClose={props.onToggleSheet} />}
      </AnimatePresence>

      {/* Desk-distance, inside the footer, never on the stage (1.1, 1.2). */}
      <FooterNotice notice={props.notice} onDismiss={props.onDismissNotice} />

      <div
        // Wrap rather than clip. Twelve controls fit every projector width we
        // target, but a bar that silently pushes "End" off the right edge of a
        // narrow one is a failure mode with no warning and no recovery.
        //
        // Grouped by proximity rather than by drawn dividers (6.4): a wider
        // gap between groups than within them is grouping that exists, and
        // it survives a wrap, which a hairline between two rows does not.
        className="flex flex-wrap justify-center items-center gap-5 max-w-[92vw] rounded-pill px-4 py-2.5 shadow-elev-2"
        style={{
          background: "color-mix(in oklch, var(--surface-1), transparent 22%)",
          backdropFilter: "blur(16px)",
        }}
      >
        {/* ── Transport. First, because it is 80% of every press, and `Next`
            large for the same reason (6.4). Both `Next` and `Scores` sit in
            slots of fixed width so neither a label change ("Next" →
            "Standings") nor the first answer landing moves the target the
            hand is already over (6.3). ───────────────────────────────── */}
        <div className="flex items-center gap-1.5">
          {inLobby ? (
            <Button
              variant="primary"
              size="lg"
              disabled={!props.canStart}
              onClick={props.onStart}
              className="min-w-[10.5rem]"
            >
              Start
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="md" disabled={props.prevDisabled} onClick={props.onPrev}>
                ← Back
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={props.onNext}
                disabled={props.nextDisabled}
                className="min-w-[10.5rem]"
              >
                {props.nextLabel} →
              </Button>
            </>
          )}

          {/* Sits with Back/Next because it is the same verb at a different
              distance: those move one slide, this moves any number. Available
              from the lobby too — opening a deck at slide 4 is a legitimate
              thing to want, and `goto` has always supported it. */}
          {props.slides.length > 0 && (
            <Button
              variant={props.navOpen ? "secondary" : "ghost"}
              size="md"
              onClick={props.onToggleNav}
              aria-expanded={props.navOpen}
              aria-haspopup="dialog"
              title="Go to any slide (g)"
            >
              Slides
            </Button>
          )}
        </div>

        {/* ── The room: what is on the big screen besides the slide. ──── */}
        <div className="flex items-center gap-1.5">
          {!inLobby && (
            // The slot is always there; the button appears in it. Width
            // covers the longer of its two labels.
            <span className="inline-flex justify-center w-[8.5rem]">
              {props.hasScores && (
                <Button variant="ghost" size="md" onClick={props.onToggleLeaderboard} className="w-full">
                  {props.leaderboardOpen ? "Hide scores" : "Scores"}
                </Button>
              )}
            </span>
          )}
          <Button
            variant={props.qaStageOpen ? "secondary" : "ghost"}
            size="md"
            onClick={props.onToggleQaStage}
            title="Put the audience's questions on the big screen"
          >
            Q&amp;A
          </Button>
          <Button variant="ghost" size="md" onClick={props.onOpenQaPanel} title="Moderate questions">
            Moderate
            {/* The queue, before the panel is open (6.8): the number is the
                reason to press, so it belongs on the button. */}
            {props.qaWaiting > 0 && (
              <span
                className="nums inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-pill bg-accent text-accent-ink text-caption font-bold"
                aria-label={`${props.qaWaiting} waiting`}
              >
                {props.qaWaiting}
              </span>
            )}
          </Button>
          {props.selfPaced && (
            <span
              className="text-caption font-semibold uppercase track-label text-ink-subtle px-2"
              title="Each player moves through the deck at their own pace; there is no shared clock"
            >
              Self-paced
            </span>
          )}
        </div>

        {/* ── Settings and stop. Everything you set once and stop thinking
            about collapses into `More`; `End` stays last, alone, where a
            destructive verb can be aimed at deliberately (6.4). The split is
            by WHEN, not by category: Back/Next/Slides/Scores/Q&A are touched
            throughout a session; notes, lighting, fullscreen, sound, the CSV
            and now Edit deck are touched once. ──────────────────────── */}
        <div className="flex items-center gap-1.5">
          <MoreMenu
            label="Presenter settings"
            triggerLabel="More"
            placement="above"
            size="md"
            actions={moreActions}
          />
          <EndButton onEnd={props.onEnd} />
        </div>
      </div>
    </motion.footer>
  );
}

// Ending a session is irreversible, kicks every phone in the room out of the
// game, and sat one pixel away from "Export" in a row of identically-sized
// ghost buttons. One mis-click in front of an audience and the room is gone
// with no undo — the single worst thing a stray press can do in this product.
//
// The confirmation is INLINE rather than a window.confirm() for two reasons
// specific to this surface: a native dialog drops the browser out of
// fullscreen on some engines (so the projector flashes desktop at the room),
// and it is rendered by the OS at OS size, which is not a size this stage
// controls. A button that asks again in place does neither.
//
// It disarms itself after four seconds. A confirmation left armed is a trap of
// its own: a host who walked away and came back would find "Sure?" sitting
// where "End" used to be, and press it believing it is the first press.
function EndButton({ onEnd }: { onEnd: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <Button
      variant="danger"
      size="md"
      onClick={() => (armed ? onEnd() : setArmed(true))}
      aria-live="polite"
      title={armed ? "Press again to end the session for everyone" : "End the session"}
    >
      {armed ? "End for everyone?" : "End"}
    </Button>
  );
}

// The end of the session. No cartoon 1-2-3 blocks: the winner's own colour
// floods the screen (DESIGN.md §5).
function FinalResults({
  entries,
  canExport,
  exportBusy,
  exportError,
  onExport,
  onAgain,
  onEdit,
  onBack,
}: {
  entries: LeaderboardEntry[];
  canExport: boolean;
  exportBusy: boolean;
  exportError: string | null;
  onExport: () => void;
  onAgain: () => void;
  onEdit: () => void;
  onBack: () => void;
}) {
  useEffect(() => {
    if (entries.length === 0) return;
    // Two bursts 180ms apart — the difference between a celebration and clip art.
    const a = window.setTimeout(() => burstAt(window.innerWidth / 2, window.innerHeight * 0.42, 90), 240);
    const b = window.setTimeout(() => burstAt(window.innerWidth / 2, window.innerHeight * 0.36, 130), 420);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [entries.length]);

  return (
    <div className="h-[100dvh] flex flex-col items-center justify-center gap-9 px-stage-safe bg-canvas text-ink overflow-hidden">
      <StageBloom />
      <p className="relative z-10 text-stage-label font-semibold uppercase track-label text-ink-subtle">
        Final results
      </p>
      {entries.length > 0 ? (
        <>
          <div className="relative z-10">
            <Podium entries={entries} stage />
          </div>
          <div className="relative z-10 w-full max-w-2xl">
            <LeaderboardList entries={entries.slice(0, 8)} />
          </div>
        </>
      ) : (
        <p className="relative z-10 text-stage-name text-ink-muted">No quiz scores in this session.</p>
      )}
      {/* Four doors, because this screen used to have one and it led away
          from everything the host actually wanted next.
          
          The three most likely next moves — run it for the group waiting
          outside, take the data, fix the question that confused everyone —
          each cost a trip out to the dashboard and back in: 3 clicks to reach
          an Export button that had been on screen one press earlier, 2 to
          start the deck again. An ending is where the next thing begins; a
          screen that only offers "leave" treats it as a full stop.
          
          All four are quiet. The winner's colour is the subject here
          (DESIGN.md §5) and a row of accent buttons underneath would argue
          with it — these are chrome at the edge of a celebration, not the
          celebration. */}
      <div className="relative z-10 flex flex-wrap items-center justify-center gap-2.5">
        <Button variant="secondary" size="lg" onClick={onAgain}>
          Present again
        </Button>
        {/* Hidden rather than disabled when there is no session to export:
            a dead control invites a press and explains nothing. */}
        {canExport && (
          <Button variant="secondary" size="lg" disabled={exportBusy} onClick={onExport}>
            {exportBusy ? "Preparing…" : "Download results"}
          </Button>
        )}
        <Button variant="ghost" size="lg" onClick={onEdit}>
          Edit deck
        </Button>
        {/* Named for where it goes, like every other door (F1, 6.8): "Done"
            was the one unnamed exit in the product. */}
        <Button variant="ghost" size="lg" onClick={onBack}>
          ← Decks
        </Button>
      </div>
      {/* A failed download says so where the button is — stage ladder,
          because this screen is projected. */}
      {exportError && (
        <p role="alert" className="relative z-10 text-stage-label font-semibold text-warn text-center">
          Download didn't start — {exportError}
        </p>
      )}
    </div>
  );
}
