import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { api } from "../lib/api";
import { getPresenting } from "../lib/liveSession";
import { Button } from "./ui/Button";
import { duration as dur, prefersReducedMotion } from "../lib/motion";
import { cn } from "../lib/cn";

/**
 * "You are still presenting this deck."
 *
 * The flow this exists for: a host is mid-session, spots a typo on the next
 * slide, and ducks into the editor to fix it. Before this bar, the editor was
 * indistinguishable from the editor on any ordinary Tuesday — no sign that a
 * room of people was sitting in front of a frozen slide, and no way back to
 * them except a browser Back button the host could not see (they were in
 * fullscreen) and could not recover (they had reloaded). The room was still
 * resumable; the host just had no reason to believe it.
 *
 * The bar is deliberately a strip and not a modal: fixing the typo is the task
 * the host came here for, and a modal would make them dismiss something before
 * doing it. It reports state and offers one door. That is all.
 *
 * It never trusts the breadcrumb alone. A crumb can outlive its room — the
 * host may have ended the session in another tab, or the server may have
 * reaped it — so we ask the server whether a session with that join code is
 * still LOBBY or ACTIVE, and render nothing until it says yes. A banner that
 * sends a host back to a dead room is worse than no banner.
 */
export function LiveRoomBar({
  deckId,
  title,
  onLive,
  contentClassName,
}: {
  /**
   * Scope the bar to one deck (the editor, where showing a banner about a
   * *different* deck would be noise). Omit it on surfaces that are about no
   * deck in particular — the dashboard — and the crumb names its own deck.
   */
  deckId?: string;
  /** Shown only when the bar isn't already sitting inside the deck it names. */
  title?: string;
  /**
   * Fired once this bar has CONFIRMED with the server that the room is open
   * (or confirmed that it isn't). Exists so a page can hang other live-session
   * UI off the same verification instead of reading the breadcrumb itself —
   * two components independently deciding whether a session is live is two
   * answers to one question, and the one that skips the server check is the
   * one that will be wrong in front of a room (DESIGN.md P1).
   */
  onLive?: (joinCode: string | null) => void;
  /**
   * The band is always full-bleed — a status strip that stops short of the
   * window edge reads as a card, and a card implies something dismissible.
   * Its CONTENTS follow whatever grid the host page uses, which the page is
   * the only thing that knows.
   */
  contentClassName?: string;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const crumb = getPresenting(deckId);
    if (!crumb) return;
    const deck = crumb.deckId;

    let live = true;
    api
      .listSessions(deck)
      .then((sessions) => {
        if (!live) return;
        // ENDED is the only status that means "gone". LOBBY counts: a host who
        // stepped out before pressing Start still has a room full of phones
        // showing the join code, and that is exactly the room they need to
        // get back to.
        const open = sessions.find(
          (s) => s.joinCode === crumb.joinCode && s.status !== "ENDED"
        );
        if (open) {
          setCode(open.joinCode);
          setTarget(deck);
        }
        onLive?.(open ? open.joinCode : null);
      })
      .catch(() => {
        // Offline or a failed read. Stay silent rather than guess: the cost of
        // a missing banner is one extra navigation, the cost of a wrong one is
        // a host walking back to a room that isn't there in front of an
        // audience. Subscribers hear "not live" for the same reason.
        if (live) onLive?.(null);
      });

    return () => {
      live = false;
    };
    // `onLive` is deliberately not a dependency: callers pass an inline arrow,
    // and depending on it would re-run this verification — a network call —
    // on every render of the host page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  if (!code || !target) return null;
  const reduced = prefersReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.base }}
      className="shrink-0 border-b border-hairline"
      style={{ background: "color-mix(in oklch, var(--accent), transparent 90%)" }}
    >
      <div className={cn("px-5 py-2.5 flex items-center justify-between gap-4", contentClassName)}>
      <p className="flex items-center gap-2.5 min-w-0 text-subhead text-ink">
        <i className="shrink-0 w-2 h-2 rounded-pill bg-accent animate-pulse" aria-hidden="true" />
        <span className="font-semibold shrink-0">
          {title ? "You're presenting" : "You're presenting this deck"}
        </span>
        {title && <span className="font-semibold truncate">{title}</span>}
        <span className="text-ink-subtle shrink-0">
          — room <span className="code text-ink">{code}</span> is still open
        </span>
      </p>
      <Button
        variant="primary"
        size="sm"
        className="shrink-0"
        onClick={() => navigate(`/present/${target}`)}
      >
        Back to the room
      </Button>
      </div>
    </motion.div>
  );
}
