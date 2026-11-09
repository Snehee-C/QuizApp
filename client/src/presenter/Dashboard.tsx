import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { api, type Presentation } from "../lib/api";
import { useAuth } from "../auth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

export default function Dashboard() {
  const [items, setItems] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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

  async function remove(id: string) {
    if (!confirm("Delete this deck? This cannot be undone.")) return;
    await api.deletePresentation(id);
    setItems((items) => items.filter((i) => i.id !== id));
  }

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <header className="sticky top-0 z-20 bg-canvas/80 backdrop-blur border-b border-hairline">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="font-display font-bold text-title3">
            Floodlight
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/templates">
              <Button variant="ghost" size="sm">
                Templates
              </Button>
            </Link>
            <Link to="/transfer">
              <Button variant="ghost" size="sm">
                Import / export
              </Button>
            </Link>
            <span className="text-subhead text-ink-subtle hidden sm:block">{user?.name}</span>
            <Button variant="ghost" size="sm" onClick={logout}>
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between gap-4 mb-7">
          <h1 className="font-display text-large-title font-bold leading-none">Your decks</h1>
          <Button variant="primary" size="md" onClick={createNew}>
            New deck
          </Button>
        </div>

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
                <div className="flex items-center gap-1.5 shrink-0">
                  <Link to={`/edit/${p.id}`}>
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </Link>
                  <Link to={`/history/${p.id}`}>
                    <Button variant="ghost" size="sm">
                      History
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => duplicate(p.id)}>
                    Duplicate
                  </Button>
                  <Link to={`/present/${p.id}`}>
                    <Button variant="secondary" size="sm">
                      Present
                    </Button>
                  </Link>
                  <Button variant="danger" size="sm" onClick={() => remove(p.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
}
