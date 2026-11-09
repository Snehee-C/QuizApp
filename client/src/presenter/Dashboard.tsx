import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { api, type Presentation } from "../lib/api";
import { useAuth } from "../auth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { LiveRoomBar } from "../components/LiveRoomBar";
import { MoreMenu } from "../components/MoreMenu";
import { exportDeckToFile } from "../lib/deckFile";
import { getLastRun, getPresenting } from "../lib/liveSession";
import { LastRunBar } from "../components/LastRunBar";
import { useScrollMemory } from "../lib/scrollMemory";

export default function Dashboard() {
  const [items, setItems] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, logout } = useAuth();
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

  async function createNew() {
    const p = await api.createPresentation("Untitled deck");
    navigate(`/edit/${p.id}`);
  }

  async function duplicate(id: string) {
    const copy = await api.duplicatePresentation(id);
    navigate(`/edit/${copy.id}`);
  }

  // Exporting is a per-deck verb, so it lives on the deck. It used to mean
  // leaving this list, finding the same deck again in a second list on the
  // Import/export page, and pressing Download beside it (lib/deckFile.ts).
  const [exportError, setExportError] = useState<string | null>(null);
  async function exportDeck(p: Presentation) {
    setExportError(null);
    try {
      await exportDeckToFile(p.id, p.title);
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : "Could not export that deck.");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this deck? This cannot be undone.")) return;
    await api.deletePresentation(id);
    setItems((items) => items.filter((i) => i.id !== id));
  }

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      {/* The fill is a color-mix, not `bg-canvas/80`: the slash-alpha cannot
          inject an alpha channel into an `oklch()` token and computes to fully
          transparent, so this header has been relying on `backdrop-blur`
          alone — page content scrolled underneath it blurred but untinted. */}
      <header
        className="sticky top-0 z-20 backdrop-blur border-b border-hairline"
        style={{ background: "color-mix(in oklch, var(--canvas), transparent 20%)" }}
      >
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          {/* Inside the app, a wordmark means "home" and home is the deck
              list — not the marketing page, which is where this pointed from
              every signed-in screen. Clicking a logo should never log you out
              of the feeling of being in the product. */}
          <Link to="/dashboard" className="font-display font-bold text-title3">
            Floodlight
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/templates">
              <Button variant="ghost" size="sm">
                Templates
              </Button>
            </Link>
            {/* Import only. Export moved onto the deck rows, where the deck
                is — so this link now names one task instead of two. */}
            <Link to="/transfer">
              <Button variant="ghost" size="sm">
                Import
              </Button>
            </Link>
            <span className="text-subhead text-ink-subtle hidden sm:block">{user?.name}</span>
            <Button variant="ghost" size="sm" onClick={logout}>
              Log out
            </Button>
          </div>
        </div>
      </header>

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
          <Button variant="primary" size="md" onClick={createNew}>
            New deck
          </Button>
        </div>

        {/* A row-level failure, reported once above the list rather than
            inside the row: the menu it came from has already closed, so there
            is nowhere in the row left to put it. */}
        {exportError && (
          <p role="status" className="text-subhead text-ink-muted mb-3">
            {exportError}
          </p>
        )}

        {loading && <p className="text-ink-subtle">Loading…</p>}

        {!loading && items.length === 0 && (
          <Card level={0} className="px-7 py-12 text-center">
            <p className="font-display text-title2 font-bold mb-2">No decks yet</p>
            <p className="text-ink-subtle text-subhead mb-6">
              Build a deck of questions, then put the join code on the big screen.
            </p>
            <Button variant="primary" size="md" onClick={createNew}>
              Create your first deck
            </Button>
          </Card>
        )}

        <div className="flex flex-col gap-2.5">
          {items.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.035, duration: 0.24 }}
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
                <Link to={`/edit/${p.id}`} className="flex-1 min-w-0" title={`Edit "${p.title}"`}>
                  <p className="font-semibold text-callout truncate">{p.title}</p>
                  <p className="nums text-footnote text-ink-subtle mt-0.5">
                    {p._count?.slides ?? 0} slide{(p._count?.slides ?? 0) === 1 ? "" : "s"}
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
                  <Link to={`/present/${p.id}`}>
                    <Button variant="secondary" size="sm">
                      Present
                    </Button>
                  </Link>
                  <MoreMenu
                    label={`More actions for "${p.title}"`}
                    actions={[
                      { label: "Session history", onSelect: () => navigate(`/history/${p.id}`) },
                      { label: "Duplicate", onSelect: () => duplicate(p.id) },
                      { label: "Export as file", onSelect: () => exportDeck(p) },
                      { label: "Delete deck", onSelect: () => remove(p.id), danger: true },
                    ]}
                  />
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
}
