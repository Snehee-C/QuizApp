import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { api, type TemplateSummary } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { duration as dur, STAGGER, prefersReducedMotion } from "../lib/motion";

export default function Templates() {
  const [items, setItems] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which template is mid-copy. Per-id rather than a page-wide flag so the
  // gallery stays usable if one duplicate is slow.
  const [busy, setBusy] = useState<string | null>(null);
  const [useError, setUseError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    api
      .listTemplates()
      .then((data) => live && setItems(data))
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load templates.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  // "Use this template" is just a duplicate into the current account — the copy
  // is an ordinary deck, so we drop the host straight into its editor.
  async function copyTemplate(t: TemplateSummary) {
    setBusy(t.id);
    setUseError(null);
    try {
      const copy = await api.duplicatePresentation(t.id);
      navigate(`/edit/${copy.id}`);
    } catch (e: unknown) {
      setUseError(e instanceof Error ? e.message : "Could not copy this template.");
      setBusy(null);
    }
  }

  const reduced = prefersReducedMotion();

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <header className="sticky top-0 z-20 bg-canvas/80 backdrop-blur border-b border-hairline">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="font-display font-bold text-title3">
            Floodlight
          </Link>
          <Link to="/dashboard">
            <Button variant="ghost" size="sm">
              Back to decks
            </Button>
          </Link>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-10">
        <div className="mb-7">
          <h1 className="font-display text-large-title font-bold leading-none">Templates</h1>
          <p className="text-ink-subtle text-subhead mt-2">
            Start from a ready-made deck. You get your own copy — the original stays untouched.
          </p>
        </div>

        {loading && <p className="text-ink-subtle">Loading…</p>}

        {!loading && error && (
          <Card level={0} className="px-7 py-10 text-center">
            <p className="font-display text-title2 font-bold mb-2">
              Couldn’t load the template gallery
            </p>
            <p className="text-ink-subtle text-subhead">{error}</p>
          </Card>
        )}

        {!loading && !error && items.length === 0 && (
          <Card level={0} className="px-7 py-12 text-center">
            <p className="font-display text-title2 font-bold mb-2">
              No templates yet
            </p>
            <p className="text-ink-subtle text-subhead mb-6">
              A deck shows up here once it’s marked as a template in its editor. Mark one of
              yours and anyone can start from it.
            </p>
            <Link to="/dashboard">
              <Button variant="primary" size="md">
                Go to your decks
              </Button>
            </Link>
          </Card>
        )}

        {useError && (
          <p className="text-subhead text-ink-muted mb-3" role="status">
            {useError}
          </p>
        )}

        <div className="grid gap-2.5 sm:grid-cols-2">
          {items.map((t, i) => {
            const slides = t._count?.slides ?? 0;
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: reduced ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * STAGGER, duration: dur.base }}
              >
                <Card
                  level={1}
                  className="h-full flex flex-col gap-4 px-5 py-5 transition-colors duration-fast hover:bg-surface-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-callout leading-snug">{t.title}</p>
                    <p className="text-footnote text-ink-subtle mt-1">
                      <span className="nums">{slides}</span> slide{slides === 1 ? "" : "s"}
                      {" · "}
                      {t.owner?.name ?? "Unknown author"}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="md"
                    className="self-start"
                    disabled={busy !== null}
                    onClick={() => copyTemplate(t)}
                  >
                    {busy === t.id ? "Copying…" : "Use this template"}
                  </Button>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
