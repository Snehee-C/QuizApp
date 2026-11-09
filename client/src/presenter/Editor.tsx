import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "motion/react";
import {
  api,
  parseConfig,
  type PresentationWithSlides,
  type Slide,
  type SlideType,
} from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { cn } from "../lib/cn";
import { SLIDE_GROUPS, labelFor, slideType, typesInGroup } from "../slides/registry";
import { ThemePicker } from "../components/ThemePicker";

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const [pres, setPres] = useState<PresentationWithSlides | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();

  async function load(keepSelection = true) {
    if (!id) return;
    const data = await api.getPresentation(id);
    setPres(data);
    setSelectedId((cur) => {
      if (keepSelection && cur && data.slides.some((s) => s.id === cur)) return cur;
      return data.slides[0]?.id ?? null;
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function addSlide(type: SlideType) {
    if (!id) return;
    const def = slideType(type);
    const slide = await api.addSlide(id, type, "", def ? def.defaultConfig() : {});
    await load(false);
    setSelectedId(slide.id);
  }

  async function duplicate(slide: Slide) {
    if (!id) return;
    const created = await api.addSlide(
      id,
      slide.type,
      slide.question,
      parseConfig(slide)
    );
    await load(false);
    setSelectedId(created.id);
  }

  async function deleteSlide(slideId: string) {
    if (!id) return;
    if (!confirm("Delete this slide?")) return;
    await api.deleteSlide(id, slideId);
    if (selectedId === slideId) setSelectedId(null);
    await load();
  }

  // Reorder is a swap with the neighbour, persisted as a full id order. The
  // API already supported this; it just had no UI.
  async function move(index: number, dir: -1 | 1) {
    if (!id || !pres || busy) return;
    const target = index + dir;
    if (target < 0 || target >= pres.slides.length) return;
    const order = pres.slides.map((s) => s.id);
    [order[index], order[target]] = [order[target], order[index]];
    // Optimistic: reordering should feel instant, and the server call is a
    // simple reindex that can't partially fail.
    setPres({
      ...pres,
      slides: order.map((sid) => pres.slides.find((s) => s.id === sid)!),
    });
    setBusy(true);
    try {
      await api.reorderSlides(id, order);
    } finally {
      setBusy(false);
    }
  }

  async function renameTitle(title: string) {
    if (!id) return;
    setPres((p) => (p ? { ...p, title } : p));
    await api.updatePresentation(id, { title });
  }

  // Deck-level settings. Applied optimistically — these are single-field
  // writes that cannot partially fail, and a laggy theme swatch feels broken.
  async function patchDeck(patch: Partial<PresentationWithSlides>) {
    if (!id || !pres) return;
    setPres({ ...pres, ...patch } as PresentationWithSlides);
    await api.updatePresentation(id, patch as any);
  }

  const selected = pres?.slides.find((s) => s.id === selectedId) ?? null;

  if (!pres) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-canvas text-ink-subtle">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-canvas text-ink overflow-hidden">
      <header className="shrink-0 border-b border-hairline px-5 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/dashboard"
            className="text-ink-subtle hover:text-ink transition-colors duration-fast shrink-0"
            aria-label="Back to dashboard"
          >
            ←
          </Link>
          <input
            className="font-display font-bold text-body bg-transparent outline-none min-w-0 flex-1 rounded-xs px-1 -mx-1 focus:shadow-focus"
            value={pres.title}
            onChange={(e) => renameTitle(e.target.value)}
            aria-label="Deck title"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/history/${id}`)}>
            History
          </Button>
          <Button
            variant={settingsOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
          >
            Deck settings
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={pres.slides.length === 0}
            onClick={() => navigate(`/present/${id}`)}
          >
            Present
          </Button>
        </div>
      </header>

      {settingsOpen && (
        <DeckSettings
          pres={pres}
          onPatch={patchDeck}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <div className="flex-1 min-h-0 flex">
        {/* ── slide rail ─────────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 border-r border-hairline overflow-y-auto p-3 flex flex-col gap-2">
          {pres.slides.map((s, i) => (
            <div key={s.id} className="group relative">
              <button
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-md transition-colors duration-fast",
                  selectedId === s.id
                    ? "bg-surface-2 shadow-line"
                    : "hover:bg-surface-1"
                )}
              >
                <p className="nums text-caption2 font-semibold uppercase track-label text-ink-subtle mb-0.5">
                  {i + 1} · {labelFor(s.type)}
                  {parseConfig(s).isQuiz ? " · quiz" : ""}
                </p>
                <p className="text-subhead font-medium truncate">
                  {s.question || <span className="text-ink-subtle">Untitled question</span>}
                </p>
              </button>
              <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-fast">
                <RailButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </RailButton>
                <RailButton
                  label="Move down"
                  disabled={i === pres.slides.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </RailButton>
              </div>
            </div>
          ))}

          <div className="mt-2 pt-3 border-t border-hairline flex flex-col gap-3">
            {SLIDE_GROUPS.map((group) => {
              const types = typesInGroup(group.key);
              if (types.length === 0) return null;
              return (
                <div key={group.key} className="flex flex-col gap-1">
                  <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle px-1">
                    {group.label}
                  </p>
                  {types.map((t) => (
                    <button
                      key={t.type}
                      onClick={() => addSlide(t.type)}
                      className="text-left px-3 py-2 rounded-sm text-subhead text-ink-muted hover:bg-surface-1 hover:text-ink transition-colors duration-fast"
                      title={t.hint}
                    >
                      + {t.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── editor ─────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 overflow-y-auto px-8 py-8">
          {selected ? (
            <SlideForm
              key={selected.id}
              presentationId={id!}
              slide={selected}
              onChanged={load}
              onDelete={() => deleteSlide(selected.id)}
              onDuplicate={() => duplicate(selected)}
            />
          ) : (
            <p className="text-ink-subtle">Select or add a slide to edit it.</p>
          )}
        </main>
      </div>
    </div>
  );
}


// Deck-level settings: how the stage looks, who drives the deck, and whether
// it is offered to others as a template.
function DeckSettings({
  pres,
  onPatch,
  onClose,
}: {
  pres: PresentationWithSlides;
  onPatch: (patch: any) => void;
  onClose: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-hairline bg-surface-1 px-5 py-5">
      <div className="max-w-5xl flex flex-wrap items-start gap-10">
        <div>
          <Label>Stage theme</Label>
          <ThemePicker value={pres.theme} onChange={(key) => onPatch({ theme: key })} />
        </div>

        <div>
          <Label>Pacing</Label>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Pacing">
            {(
              [
                ["PRESENTER", "I drive", "Everyone sees the slide I'm on."],
                ["AUDIENCE", "Self-paced", "Each person moves at their own speed."],
              ] as const
            ).map(([key, label, hint]) => (
              <button
                key={key}
                role="radio"
                aria-checked={pres.pacing === key}
                onClick={() => onPatch({ pacing: key })}
                title={hint}
                className={cn(
                  "px-4 h-11 rounded-md text-subhead font-semibold transition-colors duration-fast",
                  pres.pacing === key
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-2 text-ink-muted hover:text-ink"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-subtle mt-2 max-w-[28ch]">
            {pres.pacing === "AUDIENCE"
              ? "Self-paced decks have no shared countdown, so quiz timing is off."
              : "Quiz questions use a shared countdown."}
          </p>
        </div>

        <div>
          <Label>Audience text</Label>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Content filter">
            {(
              [
                ["mask", "Mask", "Replace rude words with asterisks."],
                ["block", "Block", "Reject the whole answer and ask them to rephrase."],
                ["off", "Off", "Show whatever is typed."],
              ] as const
            ).map(([key, label, hint]) => (
              <button
                key={key}
                role="radio"
                aria-checked={pres.filterMode === key}
                onClick={() => onPatch({ filterMode: key })}
                title={hint}
                className={cn(
                  "px-4 h-11 rounded-md text-subhead font-semibold transition-colors duration-fast",
                  pres.filterMode === key
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-2 text-ink-muted hover:text-ink"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-subtle mt-2 max-w-[30ch]">
            Applies to word clouds, open answers, questions and nicknames — a
            blocklist catches casual abuse, not a determined person.
          </p>
        </div>

        <div>
          <Label>Pace</Label>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Countdown length">
            {(
              [
                [1, "Normal"],
                [1.5, "Relaxed"],
                [2, "Double"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                role="radio"
                aria-checked={pres.timeScale === val}
                onClick={() => onPatch({ timeScale: val })}
                className={cn(
                  "px-4 h-11 rounded-md text-subhead font-semibold transition-colors duration-fast",
                  pres.timeScale === val
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-2 text-ink-muted hover:text-ink"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-subtle mt-2 max-w-[30ch]">
            Stretches every countdown. Scores stay fair — speed is judged
            against the longer clock, not the original one.
          </p>
        </div>

        <div>
          <Label>Sharing</Label>
          <label className="flex items-start gap-3 cursor-pointer select-none max-w-[30ch]">
            <input
              type="checkbox"
              checked={pres.isTemplate}
              onChange={(e) => onPatch({ isTemplate: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-[var(--accent)]"
            />
            <span>
              <span className="font-semibold block text-subhead">Offer as a template</span>
              <span className="text-caption text-ink-subtle">
                Anyone can copy this deck into their own account.
              </span>
            </span>
          </label>
        </div>

        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function RailButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="w-6 h-6 grid place-items-center rounded-xs text-caption bg-surface-3 text-ink-muted hover:text-ink disabled:opacity-25 disabled:pointer-events-none transition-colors duration-fast"
    >
      {children}
    </button>
  );
}

// Legacy slides may carry a single `correctIndex` instead of `correctIndices`.
// Normalize so the editor only reasons about one shape.
function normalizeConfig(config: any): any {
  if (!config || typeof config !== "object") return config;
  if (Array.isArray(config.correctIndices)) return config;
  if (typeof config.correctIndex === "number") {
    return { ...config, correctIndices: [config.correctIndex] };
  }
  return config;
}

function SlideForm({
  presentationId,
  slide,
  onChanged,
  onDelete,
  onDuplicate,
}: {
  presentationId: string;
  slide: Slide;
  onChanged: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const def = slideType(slide.type);
  const [question, setQuestion] = useState(slide.question);
  const [config, setConfig] = useState<any>(normalizeConfig(parseConfig(slide)));
  const [notes, setNotes] = useState(slide.notes ?? "");

  async function save(newQuestion = question, newConfig = config, newNotes = notes) {
    await api.updateSlide(presentationId, slide.id, {
      question: newQuestion,
      config: newConfig,
      notes: newNotes,
    });
    onChanged();
  }

  // Shallow patch — the common case. `replace` exists for edits that must
  // delete keys, which a merge can't express.
  function onChange(patch: any) {
    const next = { ...config, ...patch };
    setConfig(next);
    save(question, next);
  }
  function onReplace(next: any) {
    setConfig(next);
    save(question, next);
  }

  if (!def) {
    return (
      <p className="text-ink-subtle">
        Unknown slide type <code className="font-mono">{slide.type}</code>.
      </p>
    );
  }

  const TypeEditor = def.Editor;
  const Preview = def.Preview;

  return (
    <div className="max-w-5xl grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-10">
      <div className="flex flex-col gap-7 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <span className="text-caption2 font-semibold uppercase track-label text-ink-subtle">
            {def.label}
          </span>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={onDuplicate}>
              Duplicate
            </Button>
            <Button variant="danger" size="sm" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </div>

        <div>
          <Label htmlFor="q">{def.questionLabel ?? "Question"}</Label>
          <Input
            id="q"
            className="h-14 text-body font-display font-semibold"
            placeholder={def.questionPlaceholder ?? "What do you want to ask?"}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onBlur={() => save()}
          />
        </div>

        <TypeEditor
          config={config}
          onChange={onChange}
          onReplace={onReplace}
          question={question}
        />

        <div>
          <Label htmlFor="notes">Speaker notes</Label>
          <textarea
            id="notes"
            className="w-full bg-surface-2 text-ink placeholder:text-ink-subtle rounded-md px-4 py-3 min-h-[96px] text-subhead shadow-line outline-none focus:shadow-[var(--line),var(--focus)] transition-shadow duration-fast resize-y"
            placeholder="Only you see these, on the presenter view."
            value={notes}
            maxLength={4000}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => save(question, config, notes)}
          />
        </div>
      </div>

      {/* Live phone preview. Seeing the actual player surface while editing is
          the fastest way to catch an option that is too long. */}
      <div className="hidden lg:block">
        <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle mb-3">
          {def.interactive ? "On the player's phone" : "On the big screen"}
        </p>
        <motion.div
          layout
          className="rounded-xl bg-canvas shadow-elev-2 p-4 flex flex-col gap-3 sticky top-8"
          style={{ minHeight: 420 }}
        >
          <p className="font-display font-bold text-subhead leading-snug text-ink-muted line-clamp-3 px-1">
            {question || def.questionPlaceholder || "Your question"}
          </p>
          <div className="flex-1 flex flex-col justify-center gap-2">
            {Preview ? (
              <Preview config={config} question={question} />
            ) : (
              <p className="text-footnote text-ink-subtle text-center">No preview</p>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
