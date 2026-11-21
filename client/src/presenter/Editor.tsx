import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence, Reorder } from "motion/react";
import {
  api,
  parseConfig,
  type PresentationWithSlides,
  type Slide,
  type SlideConfigIssue,
  type SlideType,
} from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { cn } from "../lib/cn";
import { SLIDE_GROUPS, labelFor, slideType, typesInGroup } from "../slides/registry";
import type { Removal } from "../slides/types";
import { ThemePicker } from "../components/ThemePicker";
import { AppHeader } from "../components/AppHeader";
import { DeckSwitcher } from "../components/DeckSwitcher";
import { LiveRoomBar } from "../components/LiveRoomBar";
import { SaveIndicator } from "../components/SaveIndicator";
import { getPresenting } from "../lib/liveSession";
import { usePaneScrollMemory } from "../lib/scrollMemory";
import { useUndoableDelete } from "../lib/undoDelete";
import { autosave } from "../lib/autosave";
import { prefersReducedMotion, spring } from "../lib/motion";
import { UndoBar } from "../components/UndoBar";
import { SlideTypePicker } from "../components/SlideTypePicker";

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

// Whether the phone preview is open on a narrow window. A per-host
// preference, not a per-visit one: a host on a 13″ laptop who wants the
// preview wants it every time (UX-PLAN 5.10).
const PREVIEW_KEY = "menti_editor_preview";

function recallPreview(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberPreview(open: boolean): void {
  try {
    localStorage.setItem(PREVIEW_KEY, open ? "1" : "0");
  } catch {
    // Costs the memory, not the toggle.
  }
}

// ── Config advisories ───────────────────────────────────────────────────
//
// WHY THIS IS SPLIT BY KIND AND NOT BY COUNT.
//
// Every slide write already came back with `configIssues` in a 200 body, and
// nothing read it, so the editor authored decks `POST /api/transfer/import`
// would refuse — the same server saying both things about the same deck. The
// obvious fix, showing all of them, is the wrong one, and it is wrong for a
// measurable reason: created through the editor's own "+ Add slide", with the
// editor's own `defaultConfig()`, the seventeen slide types produce **zero**
// `broken` issues and **sixteen** `incomplete` ones. A brand-new
// CONTENT_BULLETS is born with three. An indicator that lights up the instant
// you press a button teaches exactly one lesson, which is to stop looking at
// it.
//
// So the two kinds get the two different moments they actually have:
//
//   broken      Shown at once, where the author is: inline under the form
//               that produced it, and marked in the rail so a slide you are
//               NOT looking at is still findable. This is the one that ran in
//               front of a room in round 8 — a question with the answer key
//               pointing at option 7 of 2, which nobody could get right and
//               nothing ever mentioned. It cannot become wallpaper, because
//               creating a slide cannot produce one.
//
//   incomplete  Not shown while editing at all. A half-written slide is the
//               normal state of authoring, not a defect, and the form's live
//               phone preview already renders it visibly empty. It is counted
//               at the DECK level, in the deck check, because that is where
//               the claim "this deck is finished" gets made — and an export
//               of a deck with one is a file the importer turns down.
//
// Both registers are plain text on the existing surfaces. Neither is a toast,
// a modal, or a thing that interrupts a keystroke (DESIGN.md P2).
const brokenOf = (s: Slide): SlideConfigIssue[] =>
  (s.configIssues ?? []).filter((i) => i.kind === "broken");
const incompleteOf = (s: Slide): SlideConfigIssue[] =>
  (s.configIssues ?? []).filter((i) => i.kind === "incomplete");

/**
 * The messages are written once, on the server, next to the rule that raises
 * them — which is why they speak in `config.<key>` rather than in the labels
 * this form happens to use. Rewriting them here would be a second copy that
 * drifts from the first the day either moves (DESIGN.md P1), so they are shown
 * verbatim and the config key is simply SET as what it is: a literal string
 * you could type into a file. That is the one job mono is kept for (§3).
 */
const CONFIG_KEY = /(\bconfig\.[A-Za-z0-9_]+(?:\[\d+\])?)/g;

function IssueText({ message }: { message: string }) {
  return (
    <>
      {message.split(CONFIG_KEY).map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="font-mono text-ink">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ── Saving ──────────────────────────────────────────────────────────────
//
// Every write the editor makes goes through lib/autosave.ts — the slide's
// question, config and notes, the deck's title and settings, the slide order.
// Nothing here calls `api.update*` directly any more, and nothing renders
// "Saved" that the server has not acknowledged (PULSE.md T2). The pieces that
// are NOT patches — creating, duplicating, deleting a slide — are awaited
// with a catch that reports to the same indicator, because a failure with no
// surface is the thing this whole file used to be.

/** The leave guard reads one boolean, so it subscribes to one boolean. */
function useUnsaved(): boolean {
  return useSyncExternalStore(
    autosave.subscribe,
    () => autosave.getState().dirty,
    () => false
  );
}

type SlidePatch = { question?: string; config?: any; notes?: string };

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const [pres, setPres] = useState<PresentationWithSlides | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  // Where a slide added from the picker lands: after the selected slide (the
  // common case — you are building where you are) or at the end, by request.
  const [pickerOpen, setPickerOpen] = useState<false | "after" | "end">(false);
  const [previewOpen, setPreviewOpen] = useState(recallPreview);
  // Set only once LiveRoomBar has confirmed the room with the server, so the
  // rail's "on screen" marker and the banner can never disagree.
  const [roomLive, setRoomLive] = useState(false);
  const pane = useRef<HTMLElement>(null);
  // The last thing in the product that forgot where you were (FLOW.md F3).
  usePaneScrollMemory(pane, id, selectedId);
  const navigate = useNavigate();
  const unsaved = useUnsaved();

  // The deck as it is NOW, readable from callbacks that outlive a render —
  // a drag's end, a reorder writer that fires after a debounce.
  const presRef = useRef(pres);
  presRef.current = pres;

  // One place that moves the selection, so remembering it cannot be forgotten
  // at a call site. Every `setSelectedId` in this file goes through here.
  function select(slideId: string | null) {
    setSelectedId(slideId);
    if (id) rememberSlide(id, slideId);
  }

  async function load(keepSelection = true) {
    if (!id) return;
    let data: PresentationWithSlides;
    try {
      data = await api.getPresentation(id);
    } catch (e) {
      // A deck that will not load is not "Loading…" forever. Say so, and
      // offer the one thing that can be done about it.
      if (!presRef.current) {
        setLoadError(e instanceof Error ? e.message : "Couldn't load this deck");
      } else {
        autosave.notify("Couldn't refresh the deck — showing what was last loaded");
      }
      return;
    }
    setLoadError(null);
    // A GET that lands while a save is in flight or still coalescing carries
    // the pre-edit values for those fields; the editor would render a title
    // or question the host has already seen marked "Saved", then watch it
    // snap back. Overlay whatever the pipeline has not yet proven delivered.
    const deckLocal = autosave.unsaved(`deck:${id}`);
    const merged: PresentationWithSlides = {
      ...data,
      ...(deckLocal ?? {}),
      slides: data.slides.map((sl) => {
        const local = autosave.unsaved(`slide:${sl.id}`);
        return local ? { ...sl, ...local } : sl;
      }),
    };
    setPres(merged);
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

  // Leaving the editor sends whatever is still inside the debounce window.
  // The pipeline outlives this component, so the write completes without it.
  useEffect(() => () => autosave.flush(), []);

  // Closing the tab with an edit still unacknowledged is the one case where
  // interrupting is right: the alternative is losing it silently. In-app
  // navigation never trips this — the pipeline carries on after unmount.
  useEffect(() => {
    if (!unsaved) return;
    function guard(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Legacy browsers read the property; modern ones ignore its text.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unsaved]);

  /** The server's answer about a slide, folded into the deck in place. */
  function mergeSlide(saved: Slide) {
    setPres((p) =>
      p ? { ...p, slides: p.slides.map((s) => (s.id === saved.id ? { ...s, ...saved } : s)) } : p
    );
  }

  function saveSlide(slideId: string, patch: SlidePatch) {
    if (!id) return;
    autosave.patch(
      `slide:${slideId}`,
      patch,
      (merged) => api.updateSlide(id, slideId, merged as SlidePatch),
      (result) => {
        // The acked slide carries `configIssues` for the rules as the server
        // ran them on what is NOW stored — which is the whole of what the
        // inline advisory and the rail marker show.
        if (result && typeof result === "object") mergeSlide(result as Slide);
      }
    );
  }

  // Deck-level fields. Applied optimistically — single-field writes that
  // cannot partially fail, and a laggy theme swatch feels broken — and the
  // ack is NOT folded back: it would briefly revert a title typed after the
  // request left, and the pipeline is already sequential, so the last write
  // is the one that stands.
  function saveDeck(patch: Partial<PresentationWithSlides>) {
    if (!id) return;
    setPres((p) => (p ? ({ ...p, ...patch } as PresentationWithSlides) : p));
    autosave.patch(`deck:${id}`, patch as Record<string, unknown>, (merged) =>
      api.updatePresentation(id, merged as any)
    );
  }

  // The slide order as the rail shows it, persisted as one full-order write.
  // Coalesced like everything else: six quick ↓ presses are one request, not
  // six, and a press while one is on the wire queues behind it instead of
  // being dropped (UX-PLAN 5.4). The writer re-reads the deck at send time
  // and drops ids that have since been deleted, or the server would refuse
  // the order and the pipeline would retry a request that can never succeed.
  function persistOrder(order?: string[]) {
    if (!id) return;
    const ids = order ?? presRef.current?.slides.map((s) => s.id) ?? [];
    autosave.patch(`order:${id}`, { order: ids }, (merged) => {
      const live = new Set(presRef.current?.slides.map((s) => s.id) ?? []);
      const wanted = (merged.order as string[]).filter((sid) => live.has(sid));
      return api.reorderSlides(id, wanted);
    });
  }

  /** Put a freshly created slide where the host is, not at the end. */
  function insertCreated(created: Slide, afterId: string | null) {
    const cur = presRef.current;
    if (!cur) return;
    const slides = [...cur.slides];
    const at = afterId ? slides.findIndex((s) => s.id === afterId) : -1;
    const index = at === -1 ? slides.length : at + 1;
    slides.splice(index, 0, created);
    setPres({ ...cur, slides });
    // The server appends (presentations.ts assigns a monotonic `order`), so
    // anything other than "at the end" is a create followed by a reorder.
    if (index !== slides.length - 1) persistOrder(slides.map((s) => s.id));
    select(created.id);
  }

  async function addSlide(type: SlideType) {
    if (!id) return;
    const where = pickerOpen;
    setPickerOpen(false);
    const def = slideType(type);
    let created: Slide;
    try {
      created = await api.addSlide(id, type, "", def ? def.defaultConfig() : {});
    } catch {
      autosave.notify("Couldn't add the slide — check your connection and try again");
      return;
    }
    insertCreated(created, where === "end" ? null : selectedId);
  }

  async function duplicate(slide: Slide) {
    if (!id) return;
    let created: Slide;
    try {
      created = await api.addSlide(id, slide.type, slide.question, parseConfig(slide));
    } catch {
      autosave.notify("Couldn't duplicate the slide — check your connection and try again");
      return;
    }
    // Directly after its source. A copy that lands at the end of a
    // thirty-slide deck is a copy you then spend fifteen presses moving.
    insertCreated(created, slide.id);
  }

  // Same bargain as the deck list: the slide leaves the rail now, the server
  // hears about it in six seconds, and undo inside that window means it is
  // never told (lib/undoDelete.ts). Option removals inside a slide form share
  // the same hook and the same bar — one "Deleted … Undo" in the product —
  // and are told apart by their key.
  const { pending, scheduleDelete, undo, commit, windowMs } = useUndoableDelete();
  const restoreFns = useRef<Map<string, () => void>>(new Map());
  const removalSeq = useRef(0);

  function deleteSlide(slideId: string) {
    if (!id || !pres) return;
    const at = pres.slides.findIndex((s) => s.id === slideId);
    if (at === -1) return;
    const slide = pres.slides[at];
    const remaining = pres.slides.filter((s) => s.id !== slideId);
    setPres({ ...pres, slides: remaining });
    // Land on the neighbour that took its place, or the new last slide. Being
    // dropped to "nothing selected" after a delete is a second small loss on
    // top of the first, and the host has to go and pick a slide again.
    if (selectedId === slideId) {
      select(remaining[Math.min(at, remaining.length - 1)]?.id ?? null);
    }
    scheduleDelete(slideId, slide.question?.trim() || "an untitled slide", () => {
      // On failure `load()` is what puts the slide back rather than leaving
      // the rail lying — and the indicator says why it came back.
      void api.deleteSlide(id, slideId).catch(() => {
        autosave.notify("Couldn't delete the slide — it's back in the deck");
        void load();
      });
    });
  }

  /**
   * A list-row removal inside the open slide's form. Keyed apart from slide
   * deletes so the undo handler can tell which it is restoring.
   */
  function scheduleRemoval(label: string, destroy: () => void, restore: () => void): string {
    const key = `field:${++removalSeq.current}`;
    restoreFns.current.set(key, restore);
    scheduleDelete(key, label, () => {
      restoreFns.current.delete(key);
      destroy();
    });
    return key;
  }

  function onUndo(key: string) {
    if (!undo(key)) return;
    if (key.startsWith("field:")) {
      const restore = restoreFns.current.get(key);
      restoreFns.current.delete(key);
      restore?.();
      return;
    }
    // It was never deleted, so the server still has it — and re-selecting it
    // before the refetch means undo returns you to the slide you rescued.
    select(key);
    void load();
  }

  // Reorder by keyboard: a swap with the neighbour. The same full-order
  // write as a drag, so there is one spelling of "the deck is in this order".
  function move(index: number, dir: -1 | 1) {
    if (!id || !pres) return;
    const target = index + dir;
    if (target < 0 || target >= pres.slides.length) return;
    const order = pres.slides.map((s) => s.id);
    [order[index], order[target]] = [order[target], order[index]];
    setPres({
      ...pres,
      slides: order.map((sid) => pres.slides.find((s) => s.id === sid)!),
    });
    persistOrder(order);
  }

  // Reorder by drag: the rail follows the pointer locally, and the order is
  // written once, when the slide is dropped.
  function onReorder(order: string[]) {
    setPres((p) =>
      p ? { ...p, slides: order.map((sid) => p.slides.find((s) => s.id === sid)!) } : p
    );
  }

  const selected = pres?.slides.find((s) => s.id === selectedId) ?? null;
  const selectedIndex = selected ? pres!.slides.indexOf(selected) : -1;
  // Counted over the WHOLE deck, not the open slide: the fault that reached a
  // projector in round 8 was on a slide nobody was looking at.
  const slides = pres?.slides ?? [];
  const brokenSlides = slides.filter((s) => brokenOf(s).length > 0);
  const unfinishedSlides = slides.filter(
    (s) => brokenOf(s).length === 0 && incompleteOf(s).length > 0
  );
  // Which slide the room is looking at. Null unless a session is genuinely
  // open — the editor follows the projector on arrival, and the marker is how
  // the host can see that it did, and see where the room is if they then
  // navigate somewhere else in the deck.
  const liveSlideId = roomLive ? (getPresenting(id)?.slideId ?? null) : null;
  const reduced = prefersReducedMotion();

  if (!pres) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-canvas text-ink-subtle">
        {loadError ? (
          <div className="text-center flex flex-col items-center gap-3">
            <p className="text-subhead text-ink">Couldn't load this deck</p>
            <p className="text-footnote">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          "Loading…"
        )}
      </div>
    );
  }

  // Where a slide added from the rail will land, said before the choice.
  const addsAtEnd = pickerOpen === "end" || !selected || selectedIndex === slides.length - 1;
  const placement = addsAtEnd
    ? slides.length === 0
      ? undefined
      : "Added at the end of the deck"
    : `Added after slide ${selectedIndex + 1}`;

  return (
    <div className="h-[100dvh] flex flex-col bg-canvas text-ink overflow-hidden">
      <AppHeader
        width="full"
        crumb={
          <>
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
              className="font-display font-bold text-body bg-transparent outline-none min-w-0 max-w-full rounded-xs px-1 -mx-1 focus:shadow-focus"
              // Sized to the title rather than stretched across the header,
              // so the switcher's chevron sits beside the name it switches.
              size={Math.min(48, Math.max(10, pres.title.length + 2))}
              value={pres.title}
              // Through the pipeline: one PATCH when typing pauses, not one
              // per keystroke.
              onChange={(e) => saveDeck({ title: e.target.value })}
              aria-label="Deck title"
            />
            {/* The title doubles as a switcher: the five decks touched most
                recently, then the full list. Marked `· live` when this deck
                has a room open (DeckSwitcher.tsx, UX-PLAN 0.4). */}
            {id && <DeckSwitcher currentId={id} live={roomLive} />}
          </>
        }
        actions={
          <>
          {/* Whether what you see is what the server has. Desk-distance
              type, never alarming on a healthy save (SaveIndicator.tsx). */}
          <SaveIndicator className="mr-1" />
          {/* Below `lg` the phone preview has no column of its own. It used
              to simply not exist there, with nothing saying so; now it is a
              press away at any width, and the button is the notice. */}
          <Button
            variant={previewOpen ? "secondary" : "ghost"}
            size="sm"
            className="lg:hidden"
            aria-pressed={previewOpen}
            onClick={() =>
              setPreviewOpen((v) => {
                rememberPreview(!v);
                return !v;
              })
            }
          >
            Preview
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/history/${id}`)}>
            History
          </Button>
          <Button
            variant={settingsOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setSettingsOpen((v) => !v);
              setCheckOpen(false);
            }}
            aria-expanded={settingsOpen}
          >
            Deck settings
          </Button>
          {/* Nothing to say, nothing on screen. The control only exists when
              the deck has something in it worth reading before you present,
              and it names the worst of it rather than carrying two numbers —
              one count in a header bar is a status, two is a dashboard. */}
          {(brokenSlides.length > 0 || unfinishedSlides.length > 0) && (
            <Button
              variant={checkOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setCheckOpen((v) => !v);
                setSettingsOpen(false);
              }}
              aria-expanded={checkOpen}
              // The one visual escalation in this whole feature, and it is
              // spent on the kind that cannot be reached by typing more.
              // `warn`, not `danger`: nothing here destroys anything, and
              // `danger` is already the delete verb's colour (P1).
              className={cn(brokenSlides.length > 0 && "text-warn hover:text-warn")}
            >
              {brokenSlides.length > 0
                ? `${brokenSlides.length} ${brokenSlides.length === 1 ? "slide needs" : "slides need"} fixing`
                : `${unfinishedSlides.length} ${unfinishedSlides.length === 1 ? "slide" : "slides"} unfinished`}
            </Button>
          )}
          {/* One navigation, one label. When a room is open this button IS
              the way back to it, and LiveRoomBar below keeps only its status
              line rather than a second primary button to the same place
              (UX-PLAN 5.8). */}
          <Button
            variant="primary"
            size="md"
            disabled={pres.slides.length === 0}
            onClick={() => navigate(`/present/${id}`)}
          >
            {roomLive ? "Back to the room" : "Present"}
          </Button>
          </>
        }
      />

      {/* Renders only when a room for THIS deck is still open (and the server
          agrees it is). The host ducked in here to fix something; the header's
          button is the thread back out, so the bar carries status only. */}
      <LiveRoomBar deckId={id} onLive={(code) => setRoomLive(!!code)} showAction={false} />

      {settingsOpen && (
        <DeckSettings pres={pres} onPatch={saveDeck} onClose={() => setSettingsOpen(false)} />
      )}

      {checkOpen && (
        <DeckCheck
          slides={pres.slides}
          broken={brokenSlides}
          unfinished={unfinishedSlides}
          onGo={(slideId) => {
            select(slideId);
            setCheckOpen(false);
          }}
          onClose={() => setCheckOpen(false)}
        />
      )}

      <div className="flex-1 min-h-0 flex">
        {/* ── slide rail ─────────────────────────────────────────────── */}
        {/* Two parts: the list scrolls, the add control does not. The rail's
            highest-frequency control used to be the last child INSIDE the
            scroll container, so on a long deck it needed a scroll to reach
            (UX-PLAN 5.5). */}
        <aside className="w-72 shrink-0 border-r border-hairline flex flex-col min-h-0">
          {/* `layoutScroll` tells the drag reorder that this element scrolls,
              so a row dragged while the list is scrolled measures correctly. */}
          <motion.div layoutScroll className="flex-1 min-h-0 overflow-y-auto p-3">
            <Reorder.Group
              axis="y"
              values={pres.slides.map((s) => s.id)}
              onReorder={onReorder}
              className="flex flex-col gap-2 list-none m-0 p-0"
              aria-label="Slides"
            >
              {pres.slides.map((s, i) => (
                <Reorder.Item
                  key={s.id}
                  value={s.id}
                  // The order is written on drop, once — not on every row the
                  // pointer passes. The swap buttons stay for the keyboard.
                  onDragEnd={() => persistOrder()}
                  whileDrag={reduced ? undefined : { scale: 1.02 }}
                  transition={spring.default}
                  className="group relative rounded-md bg-canvas"
                >
                  <button
                    onClick={() => select(s.id)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-md transition-colors duration-fast cursor-grab active:cursor-grabbing",
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
                    {/* "needs fixing" sits ahead of the type for the same reason
                        the live marker does: ordered by what must survive the
                        truncation. Which slide, whether the room is on it, whether
                        it can be answered at all — then what kind it is. Only
                        `broken` is marked. An unfinished slide is marked nowhere
                        in this rail, deliberately: six of the seventeen types are
                        born unfinished, and a rail where every new row lights up
                        is a rail nobody reads. */}
                    <p className="nums text-caption2 font-semibold uppercase track-label text-ink-subtle mb-0.5 truncate">
                      {i + 1}
                      {s.id === liveSlideId && (
                        <>
                          {" · "}
                          <span className="text-accent">on screen</span>
                        </>
                      )}
                      {brokenOf(s).length > 0 && (
                        <>
                          {" · "}
                          <span className="text-warn">needs fixing</span>
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
                </Reorder.Item>
              ))}
            </Reorder.Group>
          </motion.div>

          {/* One press, not seventeen. The rail's job is the deck you are
              building; the catalogue of things you COULD build is a different
              question and now waits to be asked (SlideTypePicker.tsx). */}
          {/* The rule separates the deck from the thing that adds to it. With
              no deck yet there is nothing to separate, and a hairline with
              nothing above it is a line drawn for its own sake (DESIGN.md
              P2/P3: a hairline SEPARATES, it does not decorate). */}
          <div className={cn("shrink-0 p-3", pres.slides.length > 0 && "border-t border-hairline")}>
            <Button
              variant="secondary"
              size="md"
              className="w-full"
              onClick={() => setPickerOpen("after")}
            >
              + Add slide
            </Button>
            {/* Adds where you are. The end of the deck stays one press away
                for the host who is appending, and the line says which will
                happen before anything does. */}
            {selected && selectedIndex < slides.length - 1 && (
              <p className="text-caption text-ink-subtle text-center mt-2">
                after slide {selectedIndex + 1} ·{" "}
                <button
                  type="button"
                  onClick={() => setPickerOpen("end")}
                  className="underline underline-offset-2 hover:text-ink rounded-xs outline-none focus-visible:shadow-focus"
                >
                  add at end
                </button>
              </p>
            )}
          </div>
        </aside>

        {/* ── editor ─────────────────────────────────────────────────── */}
        <main ref={pane} className="flex-1 min-w-0 overflow-y-auto px-8 py-8">
          {selected ? (
            <SlideForm
              key={selected.id}
              slide={selected}
              onSave={(patch) => saveSlide(selected.id, patch)}
              onDelete={() => deleteSlide(selected.id)}
              onDuplicate={() => duplicate(selected)}
              scheduleRemoval={scheduleRemoval}
              commitRemoval={commit}
              previewOpen={previewOpen}
            />
          ) : (
            <EmptyDeck onPick={addSlide} onBrowse={() => setPickerOpen("end")} />
          )}
        </main>
      </div>

      <UndoBar pending={pending} windowMs={windowMs} onUndo={onUndo} />

      <AnimatePresence>
        {pickerOpen && (
          <SlideTypePicker
            onPick={addSlide}
            onClose={() => setPickerOpen(false)}
            placement={placement}
          />
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

// The deck check.
//
// The band under the header rather than a sheet or a popover, because
// `DeckSettings` is already exactly this shape and a second spelling of "a
// panel that drops out of the header" is a dialect (DESIGN.md P1). It is
// closed by default, opened by name, and the two groups are kept apart
// because they are not two severities of one thing — one is wrong, the other
// is simply not written yet, and a single list sorted by badness would blur
// precisely the distinction that makes any of this readable.
function DeckCheck({
  slides,
  broken,
  unfinished,
  onGo,
  onClose,
}: {
  slides: Slide[];
  broken: Slide[];
  unfinished: Slide[];
  onGo: (slideId: string) => void;
  onClose: () => void;
}) {
  const numberOf = (slide: Slide) => slides.findIndex((s) => s.id === slide.id) + 1;
  return (
    <div className="shrink-0 border-b border-hairline bg-surface-1 px-5 py-5">
      <div className="max-w-5xl flex flex-wrap items-start gap-10">
        <CheckGroup
          kind="broken"
          title="Can't be answered as written"
          hint="The room would see these run and nobody score. Typing more does not fix them — the value contradicts the rest of the slide."
          rows={broken}
          numberOf={numberOf}
          onGo={onGo}
        />
        <CheckGroup
          kind="incomplete"
          title="Not finished yet"
          hint="Normal while you're building, and nothing stops you presenting. But a deck file is only imported once every one of these is filled in, so this is what an export would be turned down for."
          rows={unfinished}
          numberOf={numberOf}
          onGo={onGo}
        />
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function CheckGroup({
  title,
  hint,
  rows,
  kind,
  numberOf,
  onGo,
}: {
  title: string;
  hint: string;
  rows: Slide[];
  kind: "broken" | "incomplete";
  numberOf: (slide: Slide) => number;
  onGo: (slideId: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="min-w-0 flex-1 basis-80">
      <h2
        className={cn(
          "text-caption2 font-semibold uppercase track-label",
          kind === "broken" ? "text-warn" : "text-ink-subtle"
        )}
      >
        {title}
      </h2>
      <p className="text-caption text-ink-subtle mt-1 mb-3 max-w-[46ch]">{hint}</p>
      <div className="flex flex-col gap-1.5">
        {rows.map((slide) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => onGo(slide.id)}
            className="text-left px-4 py-3 rounded-md bg-surface-2 hover:bg-surface-3 outline-none focus-visible:shadow-focus transition-colors duration-fast"
          >
            <p className="nums text-caption2 font-semibold uppercase track-label text-ink-subtle truncate">
              {numberOf(slide)} · {labelFor(slide.type)}
            </p>
            <p className="text-subhead font-medium truncate mt-0.5">
              {slide.question || <span className="text-ink-subtle">Untitled question</span>}
            </p>
            {(kind === "broken" ? brokenOf(slide) : incompleteOf(slide)).map((issue, i) => (
              <p key={i} className="text-footnote text-ink-muted mt-1.5">
                <IssueText message={issue.message} />
              </p>
            ))}
          </button>
        ))}
      </div>
    </section>
  );
}

// A choice whose consequence is written on each option, before the choice.
//
// The type picker's card: label, then the one line that says what picking it
// means. The deck's two largest-consequence settings used to carry that line
// in a `title=` attribute — the exact pattern FLOW.md §3 records fixing for
// the picker — and a caption under the group that described only the value
// already chosen (UX-PLAN 5.7). A person deciding needs to read both.
function ChoiceCards<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "text-left px-4 py-3 rounded-md w-52 outline-none transition-colors duration-fast focus-visible:shadow-focus",
              on ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink hover:bg-surface-3"
            )}
          >
            <span className="block text-subhead font-semibold">{o.label}</span>
            <span className={cn("block text-caption mt-0.5", on ? "text-accent-ink" : "text-ink-subtle")}>
              {o.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Deck-level settings: how the stage looks, who drives the deck, and whether
// it is offered to others as a template.
//
// Two bands, not one. "Pacing" (who advances the slides) and "Pace" (the
// relaxed-timing accommodation) sat two columns apart under near-identical
// labels, and nothing said the second was about accessibility (UX-PLAN 5.6).
// They are unrelated decisions, so they are no longer neighbours: the deck's
// settings in one band, the accommodation in its own, named for what it is.
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
    <>
      <div className="shrink-0 border-b border-hairline bg-surface-1 px-5 py-5">
        <div className="max-w-5xl flex flex-wrap items-start gap-10">
          <div>
            <Label>Stage theme</Label>
            <ThemePicker value={pres.theme} onChange={(key) => onPatch({ theme: key })} />
          </div>

          <div>
            <Label>Who advances the slides</Label>
            <ChoiceCards<"PRESENTER" | "AUDIENCE">
              label="Who advances the slides"
              value={pres.pacing}
              onChange={(pacing) => onPatch({ pacing })}
              options={[
                {
                  value: "PRESENTER",
                  label: "I do",
                  hint: "Everyone sees the slide I'm on. Quiz questions run on one shared countdown.",
                },
                {
                  value: "AUDIENCE",
                  label: "Each player",
                  hint: "Each person moves at their own speed. No shared countdown, so quiz timing is per player.",
                },
              ]}
            />
          </div>

          <div>
            <Label>Audience text</Label>
            <ChoiceCards<"mask" | "block" | "off">
              label="Content filter"
              value={pres.filterMode}
              onChange={(filterMode) => onPatch({ filterMode })}
              options={[
                { value: "mask", label: "Mask", hint: "Rude words become asterisks." },
                { value: "block", label: "Block", hint: "The whole answer is refused; they rephrase." },
                { value: "off", label: "Off", hint: "Whatever is typed is shown." },
              ]}
            />
            <p className="text-caption text-ink-subtle mt-2 max-w-[40ch]">
              Applies to word clouds, open answers, questions and nicknames — a
              blocklist catches casual abuse, not a determined person.
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
        </div>
      </div>

      <div className="shrink-0 border-b border-hairline bg-surface-1 px-5 py-5">
        <div className="max-w-5xl flex flex-wrap items-start gap-10">
          <div>
            <Label>Answer time</Label>
            <ChoiceCards<number>
              label="Answer time"
              value={pres.timeScale}
              onChange={(timeScale) => onPatch({ timeScale })}
              options={[
                { value: 1, label: "Normal · ×1", hint: "Every countdown runs as written on its slide." },
                { value: 1.5, label: "Relaxed · ×1.5", hint: "Every countdown runs half as long again." },
                { value: 2, label: "Double · ×2", hint: "Every countdown runs twice as long." },
              ]}
            />
            {/* The accommodation is named as one. Time pressure is a known
                barrier for dyslexic and ADHD players (DESIGN.md §6), and a
                host cannot choose it for them without being told it exists. */}
            <p className="text-caption text-ink-subtle mt-2 max-w-[64ch]">
              Relaxed timing exists for players who need it — time pressure is a known
              barrier for dyslexic and ADHD players. Scores stay fair: speed is judged
              against the longer clock, not the original one.
            </p>
          </div>

          <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </>
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
      // A press here must not start a drag on the row underneath.
      onPointerDown={(e) => e.stopPropagation()}
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
  slide,
  onSave,
  onDelete,
  onDuplicate,
  scheduleRemoval,
  commitRemoval,
  previewOpen,
}: {
  slide: Slide;
  /** A partial write, through the pipeline. */
  onSave: (patch: SlidePatch) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  scheduleRemoval: (label: string, destroy: () => void, restore: () => void) => string;
  commitRemoval: (key: string) => void;
  previewOpen: boolean;
}) {
  const def = slideType(slide.type);
  const [question, setQuestion] = useState(slide.question);
  const [config, setConfig] = useState<any>(normalizeConfig(parseConfig(slide)));
  const [notes, setNotes] = useState(slide.notes ?? "");
  // Straight off the slide prop, which the save ack refreshes — so this is
  // the SERVER's answer about what is now stored, not a second set of rules
  // running in the browser that could disagree with the importer. That
  // disagreement is the whole of what N9 was.
  const broken = brokenOf(slide);

  // The config as it is NOW, for the removal callbacks below, which fire
  // seconds after the render that created them.
  const configRef = useRef(config);
  configRef.current = config;

  // Removals whose write is still inside the undo window. While any is open,
  // config writes are HELD — the server must not learn of a removal that may
  // be undone, and a different edit made meanwhile would carry it. The held
  // edits go out, together, when the last window closes either way.
  const openRemovals = useRef<Set<string>>(new Set());
  const holdSeq = useRef(0);

  function writeConfig(next: any) {
    setConfig(next);
    configRef.current = next;
    if (openRemovals.current.size === 0) onSave({ config: next });
  }

  // Shallow patch — the common case. `replace` exists for edits that must
  // delete keys, which a merge can't express.
  function onChange(patch: any) {
    writeConfig({ ...configRef.current, ...patch });
  }
  function onReplace(next: any) {
    writeConfig(next);
  }

  function onRemove(removal: Removal) {
    const gone = removal.apply(configRef.current);
    setConfig(gone);
    configRef.current = gone;
    const hold = `remove:${slide.id}:${++holdSeq.current}`;
    autosave.hold(hold);
    let key = "";
    const close = () => {
      openRemovals.current.delete(key);
      autosave.release(hold);
    };
    key = scheduleRemoval(
      removal.label,
      () => {
        close();
        if (openRemovals.current.size === 0) {
          onSave({ config: configRef.current });
          // The window has already been the wait. A commit on unmount or
          // pagehide must not then sit in a debounce the page may not live
          // through.
          autosave.flush(`slide:${slide.id}`);
        }
      },
      () => {
        close();
        const back = removal.restore(configRef.current);
        setConfig(back);
        configRef.current = back;
        if (openRemovals.current.size === 0) onSave({ config: back });
      }
    );
    openRemovals.current.add(key);
  }

  // Switching slides unmounts this form. A removal still inside its window
  // commits now, the same way leaving the page commits it — otherwise the
  // row would be back on the next visit (FLOW.md: the window is the design,
  // so both ways of leaving it early are handled).
  useEffect(() => {
    const open = openRemovals.current;
    return () => {
      for (const key of [...open]) commitRemoval(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            // Through the pipeline as you type, not on blur: ⌘W after typing
            // used to lose the question silently.
            onChange={(e) => {
              setQuestion(e.target.value);
              onSave({ question: e.target.value });
            }}
          />
        </div>

        <TypeEditor
          config={config}
          onChange={onChange}
          onReplace={onReplace}
          onRemove={onRemove}
          question={question}
        />

        {/* Immediately under the controls that produced it, which is the only
            place it is useful, and only for `broken` — see the note at the
            top of this file for why "all of them" is the wrong answer. Not a
            toast and not a dialog: the author is mid-keystroke and nothing
            here is worth taking the caret away for. */}
        {broken.length > 0 && (
          <div className="rounded-md bg-surface-2 shadow-line px-5 py-4 flex flex-col gap-2">
            <p className="text-caption2 font-semibold uppercase track-label text-warn">
              {broken.length === 1 ? "This can't be answered" : "These can't be answered"}
            </p>
            {broken.map((issue, i) => (
              <p key={i} className="text-footnote text-ink-muted">
                <IssueText message={issue.message} />
              </p>
            ))}
          </div>
        )}

        <div>
          <Label htmlFor="notes">Speaker notes</Label>
          <textarea
            id="notes"
            className="w-full bg-surface-2 text-ink placeholder:text-ink-subtle rounded-md px-4 py-3 min-h-[96px] text-subhead shadow-line outline-none focus:shadow-[var(--line),var(--focus)] transition-shadow duration-fast resize-y"
            placeholder="Only you see these, on the presenter view."
            value={notes}
            maxLength={4000}
            onChange={(e) => {
              setNotes(e.target.value);
              onSave({ notes: e.target.value });
            }}
          />
        </div>
      </div>

      {/* Live phone preview. Seeing the actual player surface while editing is
          the fastest way to catch an option that is too long. Below `lg` it
          has no column, so it is opened from the header's Preview button and
          sits under the form instead of silently not existing (UX-PLAN 5.10). */}
      <div className={cn(previewOpen ? "block" : "hidden lg:block")}>
        <p className="text-caption2 font-semibold uppercase track-label text-ink-subtle mb-3">
          {def.interactive ? "On the player's phone" : "On the big screen"}
        </p>
        <motion.div
          layout
          className="rounded-xl bg-canvas shadow-elev-2 p-4 flex flex-col gap-3 sticky top-8 max-w-xs"
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
