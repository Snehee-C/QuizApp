import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getToken, type Presentation } from "../lib/api";
import { API_BASE } from "../lib/config";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { AppHeader } from "../components/AppHeader";

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
export default function DeckTransfer() {
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<string | null>(null);
  const [importError, setImportError] = useState<ImportFailure | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

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

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      {/* The shared shell (components/AppHeader.tsx) carries the way back to
          the decks, the account, and the other global places. */}
      <AppHeader />

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-10">
        <div className="mb-7">
          <h1 className="font-display text-large-title font-bold leading-none">
            Import a deck
          </h1>
          <p className="text-ink-subtle text-subhead mt-2">
            Bring in a deck saved as a <span className="font-mono text-subhead">.json</span> file.
            To send one out, open any deck's ••• menu and choose{" "}
            <span className="font-semibold text-ink-muted">Export as file</span>.
          </p>
        </div>

        {/* ---- Import ---- */}
        <section className="mb-10">
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

        {/* The "Export a deck" list that used to sit here is gone. It was a
            second copy of the deck list, one navigation away from the first,
            and existed only so you could press Download beside a row. That
            verb now lives on the row itself, in the deck's own ••• menu, where
            the deck already is (lib/deckFile.ts). Deleting the synonym rather
            than keeping both is DESIGN.md P1. */}
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
