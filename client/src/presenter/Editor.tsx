import { useEffect, useRef, useState } from "react";
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
import { LiveRoomBar } from "../components/LiveRoomBar";
import { getPresenting } from "../lib/liveSession";
import { usePaneScrollMemory } from "../lib/scrollMemory";
import { SlideTypePicker } from "../components/SlideTypePicker";
import { AnimatePresence } from "motion/react";

// Where the host was last working in this deck, per deck, for this tab.
//
// Every re-entry used to drop the host on slide 1: back from the presenter
// view, back from history, back from the dashboard, or just a reload. On a
// six-slide deck that is a scan and a click; on a thirty-slide deck it is a
// scroll, a scan and a click, every single time, to get back to the slide you
// were looking at four seconds ago. A place you return to should look the way
// you left it.
//
// sessionStorage for the same reason as the live-room crumb: this is where
// *this visit* was, not a permanent property of the deck. Writing it on every
// selection is cheap — one small string, and the alternative is losing it on
// the navigation that matters most.
const SEL_KEY = "menti_editor_slide";

function rememberSlide(deckId: string, slideId: string | null): void {
  try {
    const map = JSON.parse(sessionStorage.getItem(SEL_KEY) || "{}");
    if (slideId) map[deckId] = slideId;
    else delete map[deckId];
    sessionStorage.setItem(SEL_KEY, JSON.stringify(map));
  } catch {
    // Private-mode quota. Costs us the restore, nothing more.
  }
}

function recallSlide(deckId: string): string | null {
  try {
    return JSON.parse(sessionStorage.getItem(SEL_KEY) || "{}")[deckId] ?? null;
  } catch {
    return null;
  }
}

// The last live slide this editor already opened on, per deck.
//
// A host ducking out of a live room is almost always going to fix the thing
// the room is looking at, so the editor follows the projector rather than its
// own memory — but only when the projector has MOVED. Following it on every
// mount would mean a host who deliberately clicked slide 12 to prepare it,
// then glanced at the session history and came back, gets yanked to slide 3
// again by a room that never budged. So: the room moving is news and wins; the
// room standing still is not news, and the host's own choice stands.
const LIVE_KEY = "menti_editor_lastlive";

function readMap(key: string): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function noteLiveHonoured(deckId: string, slideId: string): void {
  try {
    sessionStorage.setItem(LIVE_KEY, JSON.stringify({ ...readMap(LIVE_KEY), [deckId]: slideId }));
  } catch {
    // Private-mode quota. The editor then follows the room on every mount
    // rather than only when it moves — noisier, never wrong.
  }
}

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const [pres, setPres] = useState<PresentationWithSlides | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Set only once LiveRoomBar has confirmed the room with the server, so the
  // rail's "on screen" marker and the banner can never disagree.
  const [roomLive, setRoomLive] = useState(false);
  const pane = useRef<HTMLElement>(null);
  // The last thing in the product that forgot where you were (FLOW.md F3).
  usePaneScrollMemory(pane, id, selectedId);
  const navigate = useNavigate();

  // One place that moves the selection, so remembering it cannot be forgotten
  // at a call site. Every `setSelectedId` in this file goes through here.
  function select(slideId: string | null) {
    setSelectedId(slideId);
    if (id) rememberSlide(id, slideId);
  }

  async function load(keepSelection = true) {
    if (!id) return;
    const data = await api.getPresentation(id);
    setPres(data);
    setSelectedId((cur) => {
      if (keepSelection && cur && data.slides.some((s) => s.id === cur)) return cur;

      // A fresh mount. Two memories can answer "where should this open", and
      // they are consulted in order of how much the host is likely to care.
      const has = (sid: string | null | undefined) =>
        !!sid && data.slides.some((s) => s.id === sid);

      // 1. The room, if it has moved since we last opened on it. Checked first
      //    because a live session is the most urgent fact about this deck, and
      //    the slide on the projector is what the host walked in here to fix.
      const live = getPresenting(id)?.slideId;
      if (!cur && has(live) && readMap(LIVE_KEY)[id] !== live) {
        noteLiveHonoured(id, live!);
        rememberSlide(id, live!);
        return live!;
      }

      // 2. Otherwise where this host was last working. Validated against the
      //    deck as it is NOW: a slide remembered from before a delete is a
      //    dangling id, and falling through to slide 1 is right then.
      const remembered = recallSlide(id);
      if (!cur && has(remembered)) return remembered;

      return data.slides[0]?.id ?? null;
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function addSlide(type: SlideType) {
    if (!id) return;
    setPickerOpen(false);
    const def = slideType(type);
    const slide = await api.addSlide(id, type, "", def ? def.defaultConfig() : {});
    await load(false);
    select(slide.id);
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
    select(created.id);
  }

  async function deleteSlide(slideId: string) {
    if (!id) return;
    if (!confirm("Delete this slide?")) return;
    await api.deleteSlide(id, slideId);
    if (selectedId === slideId) select(null);
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
  // Which slide the room is looking at. Null unless a session is genuinely
  // open — the editor follows the projector on arrival, and the marker is how
  // the host can see that it did, and see where the room is if they then
  // navigate somewhere else in the deck.
  const liveSlideId = roomLive ? (getPresenting(id)?.slideId ?? null) : null;

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
          {/* A back control names where it goes. A bare arrow is a direction,
              not a destination: it tells you that leaving is possible and
              nothing about where you land, so the only way to find out is to
              press it and see — which is the opposite of the confidence a
              back button exists to give. */}
          <Link
            to="/dashboard"
            className="shrink-0 flex items-center gap-1.5 -ml-1 px-1.5 py-1 rounded-xs text-subhead text-ink-subtle hover:text-ink transition-colors duration-fast focus-visible:shadow-focus outline-none"
          >
            <span aria-hidden="true">←</span> Decks
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

      {/* Renders only when a room for THIS deck is still open (and the server
          agrees it is). The host ducked in here to fix something; this is the
          thread back out. */}
      <LiveRoomBar deckId={id} onLive={(code) => setRoomLive(!!code)} />

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
                onClick={() => select(s.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-md transition-colors duration-fast",
                  selectedId === s.id
                    ? "bg-surface-2 shadow-line"
                    : "hover:bg-surface-1"
                )}
              >
                {/* The live marker sits next to the NUMBER, not at the end,
                    and the line truncates rather than wraps. Both follow from
                    the same thing: a marker that wrapped made one row in the
                    rail taller than its neighbours, and a marker at the end of
                    a truncating line is the first thing to disappear. Ordered
                    by what must survive — which slide, whether it is the live
                    one, then what kind it is. */}
                <p className="nums text-caption2 font-semibold uppercase track-label text-ink-subtle mb-0.5 truncate">
                  {i + 1}
                  {s.id === liveSlideId && (
                    <>
                      {" · "}
                      <span className="text-accent">on screen</span>
                    </>
                  )}
                  {" · "}
                  {labelFor(s.type)}
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

          {/* One press, not seventeen. The rail's job is the deck you are
              building; the catalogue of things you COULD build is a different
              question and now waits to be asked (SlideTypePicker.tsx). This
              also gives the slide list back the vertical space the catalogue
              was occupying on every deck. */}
          {/* The rule separates the deck from the thing that adds to it. With
              no deck yet there is nothing to separate, and a hairline with
              nothing above it is a line drawn for its own sake (DESIGN.md
              P2/P3: a hairline SEPARATES, it does not decorate). */}
          <div className={cn(pres.slides.length > 0 && "mt-2 pt-3 border-t border-hairline")}>
            <Button
              variant="secondary"
              size="md"
              className="w-full"
              onClick={() => setPickerOpen(true)}
            >
              + Add slide
            </Button>
          </div>
        </aside>

        {/* ── editor ─────────────────────────────────────────────────── */}
        <main ref={pane} className="flex-1 min-w-0 overflow-y-auto px-8 py-8">
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
            <EmptyDeck onPick={addSlide} onBrowse={() => setPickerOpen(true)} />
          )}
        </main>
      </div>

      <AnimatePresence>
        {pickerOpen && (
          <SlideTypePicker onPick={addSlide} onClose={() => setPickerOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// What an empty deck should say.
//
// It used to say "Select or add a slide to edit it" — a sentence that describes
// the mechanism and recommends nothing, next to a rail of seventeen equal
// options. A first-run host's real question is not "which of these seventeen"
// but "what does a good first slide look like", and the honest answer is: a
// multiple-choice question. So that is offered first, by name, with the two
// next-likeliest beside it and the full catalogue one press away.
//
// The three are named by wire type and resolved through the registry, so a
// type that is renamed or removed drops out of this list instead of rendering
// a button that adds nothing.
const SUGGESTED = ["MULTIPLE_CHOICE", "WORD_CLOUD", "SCALE"];

function EmptyDeck({
  onPick,
  onBrowse,
}: {
  onPick: (type: SlideType) => void;
  onBrowse: () => void;
}) {
  const suggested = SUGGESTED.map((t) => slideType(t)).filter(
    (d): d is NonNullable<typeof d> => !!d
  );
  const total = SLIDE_GROUPS.reduce((n, g) => n + typesInGroup(g.key).length, 0);

  return (
    <div className="max-w-2xl">
      <h2 className="font-display text-title1 font-bold leading-tight">
        Let's build your first slide
      </h2>
      <p className="text-ink-subtle text-subhead mt-2 mb-7 max-w-[46ch]">
        Most decks open with a question the room answers from their phones.
      </p>

      <div className="flex flex-col gap-2">
        {suggested.map((d, i) => (
          <button
            key={d.type}
            type="button"
            onClick={() => onPick(d.type)}
            className={cn(
              "text-left px-5 py-4 rounded-md outline-none transition-colors duration-fast",
              "focus-visible:shadow-focus",
              // Only the first one is the recommendation. Three equally
              // weighted buttons would reproduce the problem this replaces,
              // just with fourteen fewer of them.
              i === 0
                ? "bg-accent text-accent-ink"
                : "bg-surface-2 text-ink hover:bg-surface-3"
            )}
          >
            <span className="block text-body font-semibold">{d.label}</span>
            <span
              className={cn("block text-footnote mt-0.5", i === 0 ? "text-accent-ink" : "text-ink-subtle")}
            >
              {d.hint}
            </span>
          </button>
        ))}
      </div>

      <Button variant="ghost" size="sm" className="mt-3 -ml-3.5" onClick={onBrowse}>
        Browse all {total} slide types
      </Button>
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
