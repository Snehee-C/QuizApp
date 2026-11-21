import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { api, type Presentation } from "../lib/api";
import { useAuth } from "../auth";
import { cn } from "../lib/cn";
import { duration as dur, ease, prefersReducedMotion } from "../lib/motion";
import { useArrowFocus } from "../lib/arrowFocus";
import { formatRelative } from "../lib/relativeTime";
import { Input } from "./ui/Card";

/**
 * ⌘K / Ctrl+K — jump to anything with a name.
 *
 * FLOW.md F7's ceiling: a searchable list is the floor, a typed jump is the
 * expert path. Any place → any deck = ⌘K · type · Enter, with no hub and no
 * scan in between (UX-PLAN 0.3). Built from the pieces already in the
 * product: the type picker's filter-first modal shape and `lib/arrowFocus.ts`
 * for the keyboard contract, so it behaves like every other popup here.
 *
 * Mounted once, in App. It is inert on the presenter route — that screen has
 * its own global key handler and a projector behind it — and it never fires
 * while someone is typing into a field, with one exception: a field can opt
 * in with `data-palette-hotkey="allow"`. The deck list's filter is autofocused
 * and is where a host lands on login; without the opt-in, ⌘K would be dead on
 * the product's home page. The palette's own filter opts in so the chord
 * toggles it closed again.
 */

const PLACES: { label: string; to: string; hint: string }[] = [
  { label: "Decks", to: "/dashboard", hint: "Your deck list" },
  { label: "Templates", to: "/templates", hint: "Start from a ready-made deck" },
  { label: "Import", to: "/transfer", hint: "Bring in a deck file" },
];

function isTypingIn(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.dataset.paletteHotkey === "allow") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function CommandPalette() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // Where focus was when the chord was pressed, so closing puts it back.
  const returnTo = useRef<HTMLElement | null>(null);

  const enabled = !!user && !location.pathname.startsWith("/present/");

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== "k" && e.key !== "K") return;
      if (isTypingIn(e.target)) return;
      // Another modal (the type picker, a settings sheet) owns the screen.
      if (!open && document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      if (!open) returnTo.current = document.activeElement as HTMLElement | null;
      setOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, open]);

  // Navigating onto the presenter route with it open: close rather than linger.
  useEffect(() => {
    if (!enabled && open) setOpen(false);
  }, [enabled, open]);

  const close = useCallback(() => {
    setOpen(false);
    const el = returnTo.current;
    returnTo.current = null;
    if (el && el.isConnected) el.focus();
  }, []);

  return <AnimatePresence>{open && <Palette onClose={close} />}</AnimatePresence>;
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [decks, setDecks] = useState<Presentation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const reduced = prefersReducedMotion();

  // Fetched once per open: the list is small, and a palette that shows the
  // decks you had an hour ago is a palette that lies.
  useEffect(() => {
    let live = true;
    api
      .listPresentations()
      .then((d) => live && setDecks(d))
      .catch((e: unknown) => {
        if (live) setLoadError(e instanceof Error ? e.message : "Could not load your decks.");
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!panel.current?.contains(e.target as Node)) onClose();
    }
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  useArrowFocus(panel, { selector: "[data-item]", onEscape: onClose });

  const needle = q.trim().toLowerCase();
  const places = useMemo(
    () => PLACES.filter((p) => !needle || p.label.toLowerCase().includes(needle)),
    [needle]
  );
  const showNew = !needle || "new deck".includes(needle);
  const matches = useMemo(
    () => (decks ?? []).filter((d) => !needle || d.title.toLowerCase().includes(needle)),
    [decks, needle]
  );

  function go(to: string) {
    onClose();
    navigate(to);
  }

  async function createNew() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const p = await api.createPresentation("Untitled deck");
      go(`/edit/${p.id}`);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Could not create a deck.");
      setCreating(false);
    }
  }

  // Enter in the filter means "the obvious one": the first row on screen.
  function pickFirst() {
    const first = panel.current?.querySelector<HTMLElement>("[data-item]");
    first?.click();
  }

  const nothing = places.length === 0 && !showNew && matches.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-6 pt-24 pb-10">
      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: dur.fast }}
        className="absolute inset-0"
        style={{ background: "color-mix(in oklch, var(--canvas), transparent 20%)" }}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        initial={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: reduced ? 1 : 0.99 }}
        transition={{ duration: dur.base, ease: ease.standard }}
        className="relative w-full max-w-xl max-h-full flex flex-col rounded-xl bg-surface-1 shadow-elev-3 p-4"
      >
        <Input
          autoFocus
          data-palette-hotkey="allow"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              pickFirst();
            }
          }}
          placeholder="Jump to a deck or a place…"
          aria-label="Jump to a deck or a place"
          className="mb-3"
        />

        <div className="min-h-0 overflow-y-auto">
          {nothing && (
            <p className="text-ink-subtle text-subhead py-6 text-center">
              Nothing matches “{q.trim()}”.
            </p>
          )}

          {(places.length > 0 || showNew) && (
            <section className="mb-3">
              <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle px-3 mb-1">
                Places
              </p>
              {places.map((p) => (
                <Row key={p.to} label={p.label} hint={p.hint} onPick={() => go(p.to)} />
              ))}
              {showNew && (
                <Row
                  label={creating ? "Creating…" : "New deck"}
                  hint="A blank deck, opened in the editor"
                  disabled={creating}
                  onPick={createNew}
                />
              )}
              {createError && (
                <p role="status" className="text-footnote text-ink-muted px-3 py-1">
                  {createError}
                </p>
              )}
            </section>
          )}

          <section>
            <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle px-3 mb-1">
              Decks
            </p>
            {decks === null && !loadError && (
              <p className="text-footnote text-ink-subtle px-3 py-2">Loading…</p>
            )}
            {loadError && (
              <p role="status" className="text-footnote text-ink-muted px-3 py-2">
                {loadError}
              </p>
            )}
            {decks !== null && matches.length === 0 && !loadError && (
              <p className="text-footnote text-ink-subtle px-3 py-2">
                {decks.length === 0 ? "No decks yet." : "No decks match."}
              </p>
            )}
            {matches.map((d) => {
              const n = d._count?.slides ?? 0;
              return (
                <Row
                  key={d.id}
                  label={d.title}
                  hint={`${n} slide${n === 1 ? "" : "s"} · updated ${formatRelative(d.updatedAt)}`}
                  onPick={() => go(`/edit/${d.id}`)}
                  verbs={[
                    {
                      label: "Present",
                      onPick: () => go(`/present/${d.id}`),
                      // 1.6: an empty deck cannot be launched from here either.
                      disabled: n === 0,
                      title: n === 0 ? "Add a slide first" : undefined,
                    },
                    { label: "History", onPick: () => go(`/history/${d.id}`) },
                  ]}
                />
              );
            })}
          </section>
        </div>

        <p className="text-caption text-ink-subtle px-3 pt-3 mt-1 border-t border-hairline">
          <kbd className="font-ui">↑↓</kbd> move · <kbd className="font-ui">Enter</kbd> open ·{" "}
          <kbd className="font-ui">Tab</kbd> Present / History · <kbd className="font-ui">Esc</kbd>{" "}
          close
        </p>
      </motion.div>
    </div>
  );
}

function Row({
  label,
  hint,
  onPick,
  disabled,
  verbs,
}: {
  label: string;
  hint: string;
  onPick: () => void;
  disabled?: boolean;
  /**
   * The row's secondary verbs. Not part of the arrow-key item set — Up/Down
   * walk rows, Tab steps sideways into these — and shown on hover or focus
   * so a list of eighty decks is not a list of two hundred and forty buttons.
   */
  verbs?: { label: string; onPick: () => void; disabled?: boolean; title?: string }[];
}) {
  return (
    <div className="group flex items-center gap-1 rounded-md hover:bg-surface-2 focus-within:bg-surface-2 transition-colors duration-fast">
      <button
        type="button"
        data-item
        disabled={disabled}
        onClick={onPick}
        className={cn(
          "flex-1 min-w-0 text-left px-3 py-2 rounded-md outline-none",
          "focus-visible:shadow-focus disabled:text-ink-subtle"
        )}
      >
        <span className="block text-subhead font-semibold text-ink truncate">{label}</span>
        <span className="block text-caption text-ink-subtle mt-0.5 truncate">{hint}</span>
      </button>
      {verbs && (
        <span className="flex items-center gap-1 pr-2 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-fast">
          {verbs.map((v) => (
            <span key={v.label} title={v.title} className="inline-flex">
              <button
                type="button"
                disabled={v.disabled}
                aria-disabled={v.disabled || undefined}
                onClick={v.onPick}
                className={cn(
                  "inline-flex items-center justify-center h-8 px-3 rounded-sm",
                  "font-ui font-semibold text-footnote text-ink-muted press",
                  "hover:text-ink hover:bg-surface-3 outline-none focus-visible:shadow-focus",
                  "disabled:pointer-events-none disabled:text-ink-subtle"
                )}
              >
                {v.label}
              </button>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
