import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { api, getToken, type Presentation } from "../lib/api";
import { API_BASE } from "../lib/config";
import { useAuth } from "../auth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { duration as dur, STAGGER, prefersReducedMotion } from "../lib/motion";

/**
 * Move decks in and out of the account as JSON files.
 *
 * Everything in an uploaded file is untrusted text — it is only ever rendered
 * as React children (never as HTML), and the real validation lives on the
 * server; this page just relays what it says.
 */

interface ImportFailure {
  message: string;
  /** Slide types the server refused, when it reported them. */
  rejectedTypes: string[];
}

/** Filename the browser saves under when the server sends no usable one. */
function fallbackFilename(title: string): string {
  const stem = title
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${stem || "deck"}.json`;
}

export default function DeckTransfer() {
  const [items, setItems] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Per-deck rather than page-wide so one slow download doesn't freeze the
  // rest of the list.
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<string | null>(null);
  const [importError, setImportError] = useState<ImportFailure | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  useEffect(() => {
    let live = true;
    api
      .listPresentations()
      .then((data) => live && setItems(data))
      .catch((e: unknown) => {
        if (live) setListError(e instanceof Error ? e.message : "Could not load your decks.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  async function download(deck: Presentation) {
    setDownloading(deck.id);
    setDownloadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/transfer/${deck.id}/export`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromHeader(res.headers.get("Content-Disposition")) ?? fallbackFilename(deck.title);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setDownloadError(e instanceof Error ? e.message : "Could not export that deck.");
    } finally {
      setDownloading(null);
    }
  }

  async function importFromFile(file: File) {
    setImporting(true);
    setImportFile(file.name);
    setImportError(null);
    try {
      const text = await file.text();
      let deck: unknown;
      try {
        deck = JSON.parse(text);
      } catch {
        // Catch a wrong file here rather than spending a round trip on it.
        throw new ImportProblem("That file isn’t valid JSON.");
      }

      const res = await fetch(`${API_BASE}/api/transfer/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ deck }),
      });
      if (!res.ok) {
        // A rejected upload can come back as a non-JSON body (a size limit hit
        // before the route ran), so never assume a parsed error is there.
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          rejectedTypes?: unknown;
        };
        const rejected = Array.isArray(body.rejectedTypes)
          ? body.rejectedTypes.filter((t): t is string => typeof t === "string")
          : [];
        throw new ImportProblem(
          body.error ||
            (res.status === 413
              ? "That file is too large to import."
              : `Import failed (${res.status})`),
          rejected
        );
      }
      const created = (await res.json()) as Presentation;
      navigate(`/edit/${created.id}`);
    } catch (e: unknown) {
      setImportError(
        e instanceof ImportProblem
          ? { message: e.message, rejectedTypes: e.rejectedTypes }
          : {
              message: e instanceof Error ? e.message : "Could not import that file.",
              rejectedTypes: [],
            }
      );
      setImporting(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void importFromFile(file);
  }

  const reduced = prefersReducedMotion();

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <header className="sticky top-0 z-20 bg-canvas/80 backdrop-blur border-b border-hairline">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="font-display font-bold text-title3">
            Floodlight
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm">
                Back to decks
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
        <div className="mb-7">
          <h1 className="font-display text-large-title font-bold leading-none">
            Import &amp; export
          </h1>
          <p className="text-ink-subtle text-subhead mt-2">
            Save a deck as a <span className="font-mono text-subhead">.json</span> file to back it
            up or hand it to someone else — and bring one back the same way.
          </p>
        </div>

        {/* ---- Import ---- */}
        <section className="mb-10">
          <h2 className="text-caption font-semibold uppercase track-label text-ink-subtle mb-2">
            Import a deck
          </h2>
          <Card
            level={1}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={[
              "px-7 py-10 text-center transition-colors duration-fast",
              dragging ? "bg-surface-2 shadow-elev-2" : "",
            ].join(" ")}
          >
            <p className="font-display text-title2 font-bold mb-2">
              {dragging ? "Drop to import" : "Drop a deck file here"}
            </p>
            <p className="text-ink-subtle text-subhead mb-6">
              A new deck is created in your account and opens in the editor. Nothing you already
              have is touched.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Clear the input so re-picking the same file fires again.
                e.target.value = "";
                if (file) void importFromFile(file);
              }}
            />
            <Button
              variant="primary"
              size="md"
              disabled={importing}
              onClick={() => fileInput.current?.click()}
            >
              {importing ? "Importing…" : "Choose a .json file"}
            </Button>
            {importFile && !importError && (
              <p className="text-footnote text-ink-subtle mt-4 break-all">{importFile}</p>
            )}
          </Card>

          {importError && (
            <Card level={0} className="px-5 py-4 mt-2.5" role="alert">
              <p className="font-semibold text-subhead">Import failed</p>
              <p className="text-subhead text-ink-muted mt-1">{importError.message}</p>
              {importError.rejectedTypes.length > 0 && (
                <div className="mt-3">
                  <p className="text-footnote text-ink-subtle">
                    <span className="nums">{importError.rejectedTypes.length}</span> slide type
                    {importError.rejectedTypes.length === 1 ? " was" : "s were"} rejected:
                  </p>
                  <ul className="flex flex-wrap gap-1.5 mt-2">
                    {importError.rejectedTypes.map((t) => (
                      <li
                        key={t}
                        className="font-mono text-caption bg-surface-2 text-ink-muted rounded-sm px-2 py-1"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </section>

        {/* ---- Export ---- */}
        <section>
          <h2 className="text-caption font-semibold uppercase track-label text-ink-subtle mb-2">
            Export a deck
          </h2>

          {loading && <p className="text-ink-subtle">Loading…</p>}

          {!loading && listError && (
            <Card level={0} className="px-7 py-10 text-center">
              <p className="font-display text-title2 font-bold mb-2">
                Couldn’t load your decks
              </p>
              <p className="text-ink-subtle text-subhead">{listError}</p>
            </Card>
          )}

          {!loading && !listError && items.length === 0 && (
            <Card level={0} className="px-7 py-12 text-center">
              <p className="font-display text-title2 font-bold mb-2">Nothing to export</p>
              <p className="text-ink-subtle text-subhead mb-6">
                Build a deck first, or import one from a file above.
              </p>
              <Link to="/dashboard">
                <Button variant="primary" size="md">
                  Go to your decks
                </Button>
              </Link>
            </Card>
          )}

          {downloadError && (
            <p className="text-subhead text-ink-muted mb-3" role="status">
              {downloadError}
            </p>
          )}

          <div className="flex flex-col gap-2.5">
            {items.map((p, i) => {
              const slides = p._count?.slides ?? 0;
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: reduced ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * STAGGER, duration: dur.base }}
                >
                  <Card
                    level={1}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-fast hover:bg-surface-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-callout truncate">{p.title}</p>
                      <p className="nums text-footnote text-ink-subtle mt-0.5">
                        {slides} slide{slides === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      disabled={downloading !== null}
                      onClick={() => download(p)}
                    >
                      {downloading === p.id ? "Preparing…" : "Download .json"}
                    </Button>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

/** An import failure that may carry the server's list of rejected types. */
class ImportProblem extends Error {
  rejectedTypes: string[];
  constructor(message: string, rejectedTypes: string[] = []) {
    super(message);
    this.rejectedTypes = rejectedTypes;
  }
}

/**
 * Prefer the server's own filename so the download matches the deck title it
 * sanitised; fall back only when the header is missing or unreadable.
 */
function filenameFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1] : null;
}
