import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { api, type Presentation } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card, Input } from "../components/ui/Card";
import { AppHeader } from "../components/AppHeader";
import { LiveRoomBar } from "../components/LiveRoomBar";
import { MoreMenu } from "../components/MoreMenu";
import { exportDeckToFile } from "../lib/deckFile";
import { useUndoableDelete } from "../lib/undoDelete";
import { UndoBar } from "../components/UndoBar";
import { getLastRun, getPresenting } from "../lib/liveSession";
import { LastRunBar } from "../components/LastRunBar";
import { useScrollMemory } from "../lib/scrollMemory";
import { formatRelative } from "../lib/relativeTime";

export default function Dashboard() {
  const [items, setItems] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Eighty rows deep is a real place to be; coming back to the top of the
  // list is not the same page (FLOW.md F3) — unless there is a band at the top
  // with something to say, in which case restoring the old position scrolls
  // the host straight past it.
  const hasBanner = !!getPresenting() || !!getLastRun();
  useScrollMemory("dashboard", !loading, !hasBanner);

  useEffect(() => {
    api.listPresentations().then((data) => {
      setItems(data);
      setLoading(false);
    });
  }, []);

  // Type-to-filter, the floor of FLOW.md F7's third rule: anything with a name
  // can be reached by typing it. A 104-row scan becomes four keystrokes.
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? items.filter((p) => p.title.toLowerCase().includes(needle)) : items),
    [items, needle]
  );
  // The three decks touched most recently, as cards above the list (UX-PLAN
  // 0.6): a host presents the same deck weekly, and the serial-position
  // effect says the first thing on the page is the cheapest to reach. Hidden
  // while filtering (the filter IS the shortcut then) and on a short list,
  // where a strip of three above a list of three would be the same list
  // twice.
  const recents = !needle && items.length >= 4 ? items.slice(0, 3) : [];

  // One place for a row-level failure to land. The menu an action came from
  // has already closed, and a create has no row yet, so above the list is the
  // only place that is always there.
  const [actionError, setActionError] = useState<string | null>(null);

  // Pending states, so a double-click cannot make two decks (UX-PLAN 6.7).
  // Same shape as Templates.tsx — one id in flight, the rest of the page
  // stays usable.
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);

  async function createNew() {
    if (creating) return;
    setCreating(true);
    setActionError(null);
    try {
      const p = await api.createPresentation("Untitled deck");
      navigate(`/edit/${p.id}`);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Could not create a deck.");
      setCreating(false);
    }
  }

  async function duplicate(id: string) {
    if (copying) return;
    setCopying(id);
    setActionError(null);
    try {
      const copy = await api.duplicatePresentation(id);
      navigate(`/edit/${copy.id}`);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Could not copy that deck.");
      setCopying(null);
    }
  }

  // Exporting is a per-deck verb, so it lives on the deck. It used to mean
  // leaving this list, finding the same deck again in a second list on the
  // Import/export page, and pressing Download beside it (lib/deckFile.ts).
  async function exportDeck(p: Presentation) {
    setActionError(null);
    try {
      await exportDeckToFile(p.id, p.title);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Could not export that deck.");
    }
  }

  // Deleting a deck: gone from the list at once, told to the server in six
  // seconds unless undone (lib/undoDelete.ts). The dialog this replaces said
  // "This cannot be undone", which was true and is the reason it was the wrong
  // design — the fix for an irreversible action is to make it reversible, not
  // to ask twice.
  const { pending, scheduleDelete, undo, windowMs } = useUndoableDelete();
  function remove(p: Presentation) {
    const removed = p;
    setItems((items) => items.filter((i) => i.id !== removed.id));
    scheduleDelete(removed.id, `"${removed.title}"`, () => {
      void api.deletePresentation(removed.id).catch(() => {
        // The destroy failed after the row already left the screen, so put it
        // back rather than letting the list quietly disagree with the server.
        setItems((items) =>
          items.some((i) => i.id === removed.id) ? items : [removed, ...items]
        );
      });
    });
  }

  function undoRemove(key: string) {
    if (!undo(key)) return;
    // Re-fetch rather than splicing the cached row back in at the top: its
    // position in the list is the server's to decide, and the list may have
    // moved on while the window was open.
    api.listPresentations().then(setItems).catch(() => {});
  }

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <AppHeader />

      {/* The other end of the same thread as the editor's bar. A host who
          closed the presenter tab, or wandered here to start something else,
          gets told the room is still open and handed the way back — rather
          than discovering it later from a message asking why the screen never
          changed. Named, because from here "this deck" means nothing. */}
      <LiveRoomBar
        title={items.find((p) => p.id === getPresenting()?.deckId)?.title}
        contentClassName="max-w-4xl mx-auto px-6"
      />
      {/* The run that just ended. Only when there isn't a live one — a host
          looking at "your room is still open" does not also need to be told
          about the session before it, and two stacked bands would be the
          product talking over itself. */}
      {!getPresenting() && (
        <LastRunBar
          title={items.find((p) => p.id === getLastRun()?.deckId)?.title}
          contentClassName="max-w-4xl mx-auto px-6"
        />
      )}

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between gap-4 mb-7">
          <h1 className="font-display text-large-title font-bold leading-none">Your decks</h1>
          {/* Secondary: the page's one accent goes to `Present` on the rows,
              the verb a host comes here for weekly. Creating a deck is a
              once-per-deck event (FLOW.md F5, UX-PLAN 6.1). */}
          <Button variant="secondary" size="md" disabled={creating} onClick={createNew}>
            {creating ? "Creating…" : "New deck"}
          </Button>
        </div>

        {actionError && (
          <p role="status" className="text-subhead text-ink-muted mb-3">
            {actionError}
          </p>
        )}

        {loading && <p className="text-ink-subtle">Loading…</p>}

        {!loading && items.length === 0 && (
          <Card level={0} className="px-7 py-12 text-center">
            <p className="font-display text-title2 font-bold mb-2">No decks yet</p>
            <p className="text-ink-subtle text-subhead mb-6">
              Build a deck of questions, then put the join code on the big screen.
            </p>
            <Button variant="primary" size="md" disabled={creating} onClick={createNew}>
              {creating ? "Creating…" : "Create your first deck"}
            </Button>
          </Card>
        )}

        {!loading && items.length > 0 && (
          <>
            {recents.length > 0 && (
              <section aria-label="Recent decks" className="mb-7">
                <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle mb-2">
                  Recent
                </p>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {recents.map((p) => {
                    const n = p._count?.slides ?? 0;
                    return (
                      <Card
                        key={p.id}
                        level={1}
                        className="flex flex-col gap-4 px-5 py-5 transition-colors duration-fast hover:bg-surface-2"
                      >
                        <Link to={`/edit/${p.id}`} className="min-w-0" title={`Edit "${p.title}"`}>
                          <p className="font-semibold text-title3 leading-snug truncate">{p.title}</p>
                          <p className="nums text-footnote text-ink-subtle mt-1">
                            <SlideMeta deck={p} />
                          </p>
                        </Link>
                        <div className="flex items-center gap-1.5">
                          <PresentButton id={p.id} slides={n} broken={p.brokenSlides ?? 0} size="md" />
                          <Link to={`/edit/${p.id}`}>
                            <Button variant="ghost" size="md">
                              Edit
                            </Button>
                          </Link>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}

            <Input
              autoFocus
              data-palette-hotkey="allow"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && q) {
                  e.preventDefault();
                  setQ("");
                }
              }}
              placeholder="Filter decks by title…"
              aria-label="Filter decks by title"
              className="mb-4"
            />

            {shown.length === 0 && (
              <p className="text-ink-subtle text-subhead py-6 text-center" role="status">
                No decks match “{q.trim()}”.
              </p>
            )}

            <div className="flex flex-col gap-2.5">
              {shown.map((p, i) => {
                const n = p._count?.slides ?? 0;
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 12) * 0.035, duration: 0.24 }}
                  >
                    <Card
                      level={1}
                      className="flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-fast hover:bg-surface-2"
                    >
                      {/* The title is a link to the editor, but it cannot be the ONLY
                          way in: every other action on this card wears a label, so an
                          unlabelled one reads as "there is no edit function". It is
                          also the action a host reaches for most. Kept as a link AND
                          given a button below. */}
                      <Link
                        to={`/edit/${p.id}`}
                        className="flex-1 min-w-0"
                        title={`Edit "${p.title}"`}
                      >
                        <p className="font-semibold text-callout truncate">{p.title}</p>
                        <p className="nums text-footnote text-ink-subtle mt-0.5">
                          {copying === p.id ? (
                            "Copying…"
                          ) : (
                            <SlideMeta deck={p} />
                          )}
                        </p>
                      </Link>
                      {/* Two verbs on the row, the rest one layer in. These are the
                          two things a host opens this page to do; History,
                          Duplicate and Delete are occasional, and one of them is
                          irreversible and used to sit a pixel from "Present" at
                          identical weight (MoreMenu.tsx). */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Link to={`/edit/${p.id}`}>
                          <Button variant="ghost" size="sm">
                            Edit
                          </Button>
                        </Link>
                        <PresentButton id={p.id} slides={n} broken={p.brokenSlides ?? 0} size="sm" />
                        <MoreMenu
                          label={`More actions for "${p.title}"`}
                          actions={[
                            {
                              label: "Session history",
                              onSelect: () => navigate(`/history/${p.id}`),
                            },
                            { label: "Duplicate", onSelect: () => duplicate(p.id) },
                            { label: "Export as file", onSelect: () => exportDeck(p) },
                            { label: "Delete deck", onSelect: () => remove(p), danger: true },
                          ]}
                        />
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </main>

      <UndoBar pending={pending} windowMs={windowMs} onUndo={undoRemove} />
    </div>
  );
}

/** "~12 min", "~1 h 20 min". Never "0 min": a deck with slides takes some. */
function formatEstimate(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60));
  return min < 60 ? `~${min} min` : `~${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/**
 * "12 slides · ~14 min · updated 3 d ago · 2 slides need fixing" — what a host
 * needs before pressing Present (UX-PLAN 6.2): how long it runs, so a 30-minute
 * slot can be checked against a 50-minute deck before the room is waiting, and
 * whether it will work, in the editor's own words for the same count. Plus the
 * key the list is sorted by.
 */
function SlideMeta({ deck }: { deck: Presentation }) {
  const n = deck._count?.slides ?? 0;
  const broken = deck.brokenSlides ?? 0;
  return (
    <>
      {n} slide{n === 1 ? "" : "s"}
      {n > 0 && deck.estimateSec != null && (
        <span title="Every countdown at full length, plus an allowance for each reveal and for slides without a timer">
          {" · "}
          {formatEstimate(deck.estimateSec)}
        </span>
      )}
      {" · "}
      updated {formatRelative(deck.updatedAt)}
      {/* The reason the row's Present is off, said where the count is. */}
      {n === 0 && <span className="text-ink-muted"> — add a slide first</span>}
      {broken > 0 && (
        <span className="text-warn">
          {" · "}
          {broken} {broken === 1 ? "slide needs" : "slides need"} fixing
        </span>
      )}
    </>
  );
}

/**
 * The row's primary verb (FLOW.md F5: the accent goes to the most frequent
 * action). An empty deck cannot be launched: the server would refuse it with
 * EMPTY_DECK on a projector that is already live (UX-PLAN 1.6), so the button
 * is off here, with the reason on hover and in the row's metadata.
 */
function PresentButton({
  id,
  slides,
  broken,
  size,
}: {
  id: string;
  slides: number;
  broken: number;
  size: "sm" | "md";
}) {
  const navigate = useNavigate();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  if (slides === 0) {
    return (
      // The wrapper carries the tooltip: a disabled button takes no pointer
      // events, so a title on the button itself would never show.
      <span title="Add a slide first" className="inline-flex">
        <Button variant="primary" size={size} disabled aria-disabled="true">
          Present
        </Button>
      </span>
    );
  }
  // A deck with a broken slide still launches — a host may know the slide
  // and plan to skip it — but not on one unconsidered press: a broken slide
  // is a question the room cannot answer, discovered in front of the room.
  // Same two-press shape as the stage's End (Present.tsx `EndButton`), and
  // the reason is already on the row beside it.
  if (broken > 0) {
    return (
      <Button
        variant="primary"
        size={size}
        onClick={() => (armed ? navigate(`/present/${id}`) : setArmed(true))}
        aria-live="polite"
        title={
          armed
            ? "Press again to present with the broken slides"
            : `${broken} ${broken === 1 ? "slide" : "slides"} can't be answered as written — fix in the editor first, or press twice to present anyway`
        }
      >
        {armed ? "Present anyway?" : "Present"}
      </Button>
    );
  }
  return (
    <Link to={`/present/${id}`}>
      <Button variant="primary" size={size}>
        Present
      </Button>
    </Link>
  );
}
