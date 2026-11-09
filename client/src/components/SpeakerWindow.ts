// The speaker view.
//
// Notes rendered on the presenter page would be projected along with
// everything else, which defeats the point. So they go in a SEPARATE browser
// window the host drags onto their own screen while the projector shows the
// stage — the same arrangement as PowerPoint/Keynote presenter view.
//
// It is written imperatively rather than through a React portal: the content is
// a handful of text nodes, and a portal into another document drags in style
// re-injection and a second React root for no benefit.

interface SpeakerState {
  index: number;
  total: number;
  question: string;
  notes: string;
  nextQuestion: string | null;
  participants: number;
  answered: number;
  /** The whole deck, for the jump list. Null titles mean "no longer known". */
  slides?: { index: number; title: string | null }[];
  /** Jumping from here is the leak-free route: this window is not projected. */
  onJump?: (index: number) => void;
}

let win: Window | null = null;
// The deck list is rebuilt only when the deck itself changes. updateSpeakerWindow
// runs on every answer that streams in, and tearing down a list of twenty rows
// at that rate would both waste work and yank the row out from under a host who
// is mid-click on it.
let renderedDeck = "";
let jump: ((index: number) => void) | null = null;

const SHELL = `
<!doctype html><html><head><meta charset="utf-8"><title>Speaker view</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 32px; min-height: 100vh;
    background: #0d0e13; color: #f4f5f8;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .bar { display: flex; gap: 18px; align-items: baseline;
         font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: #83868f; }
  .bar b { color: #f4f5f8; font-variant-numeric: tabular-nums; }
  h1 { font-size: clamp(22px, 3.4vw, 38px); line-height: 1.15; margin: 18px 0 20px; font-weight: 700; }
  .notes { font-size: clamp(16px, 2vw, 22px); line-height: 1.6; white-space: pre-wrap;
           background: #15161d; border: 1px solid #2a2d37; border-radius: 14px; padding: 20px 22px; }
  .notes.empty { color: #83868f; font-style: italic; }
  .next { margin-top: 22px; font-size: 14px; color: #83868f; }
  .next b { color: #b4b7bf; font-style: normal; }
  .deck { margin-top: 26px; border-top: 1px solid #2a2d37; padding-top: 18px; }
  .deck h2 { font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
             color: #83868f; margin: 0 0 10px; font-weight: 600; }
  .deck ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .deck button { width: 100%; text-align: left; display: block; cursor: pointer;
                 font: inherit; font-size: 15px; line-height: 1.35; color: #b4b7bf;
                 background: #15161d; border: 1px solid transparent; border-radius: 10px;
                 padding: 9px 12px; }
  .deck button:hover { color: #f4f5f8; border-color: #2a2d37; }
  .deck button:focus-visible { outline: 3px solid #f4f5f8; outline-offset: 2px; }
  .deck button[aria-current] { background: #22333a; color: #f4f5f8; border-color: #2a2d37; }
  .deck .n { color: #83868f; font-variant-numeric: tabular-nums; margin-right: 10px; }
  .deck button[aria-current] .n { color: #f4f5f8; }
</style></head><body>
  <div class="bar">
    <span>Slide <b id="pos">–</b></span>
    <span><b id="people">0</b> joined</span>
    <span><b id="answered">0</b> answered</span>
  </div>
  <h1 id="q"></h1>
  <div class="notes" id="notes"></div>
  <p class="next" id="next"></p>
  <!-- The jump list lives HERE rather than only on the stage, because this
       window is the one surface a projector never shows. A dual-screen host
       browses the deck without the room reading ahead. -->
  <nav class="deck" id="deck" hidden><h2>Go to slide</h2><ol id="decklist"></ol></nav>
</body></html>`;

export function openSpeakerWindow(): boolean {
  if (win && !win.closed) {
    win.focus();
    return true;
  }
  win = window.open("", "floodlight-speaker", "width=720,height=820");
  if (!win) return false; // popup blocked — caller surfaces this
  win.document.open();
  win.document.write(SHELL);
  win.document.close();
  return true;
}

export function speakerWindowOpen(): boolean {
  return !!win && !win.closed;
}

export function closeSpeakerWindow() {
  if (win && !win.closed) win.close();
  win = null;
  // A reopened window gets a fresh document, so the memo of what is already
  // drawn has to die with the old one or the list never renders again.
  renderedDeck = "";
  jump = null;
}

export function updateSpeakerWindow(s: SpeakerState) {
  if (!win || win.closed) return;
  const d = win.document;
  const set = (id: string, text: string) => {
    const el = d.getElementById(id);
    if (el) el.textContent = text;
  };
  set("pos", `${s.index + 1} / ${s.total}`);
  set("people", String(s.participants));
  set("answered", String(s.answered));
  set("q", s.question || "—");

  const notesEl = d.getElementById("notes");
  if (notesEl) {
    // textContent, never innerHTML: notes are author-supplied text and this
    // document has no sanitiser.
    notesEl.textContent = s.notes || "No notes for this slide.";
    notesEl.className = s.notes ? "notes" : "notes empty";
  }
  set("next", s.nextQuestion ? `Up next: ${s.nextQuestion}` : "Last slide.");

  jump = s.onJump ?? null;
  renderDeck(d, s);
}

function renderDeck(d: Document, s: SpeakerState) {
  const nav = d.getElementById("deck");
  const list = d.getElementById("decklist");
  if (!nav || !list) return;
  const slides = s.slides ?? [];
  if (slides.length === 0) {
    nav.hidden = true;
    renderedDeck = "";
    return;
  }
  nav.hidden = false;

  // Rebuild only when the deck's shape or names changed. The current-slide
  // highlight is cheap and is applied every tick regardless, below.
  const sig = slides.map((x) => x.title ?? "").join("\u0000");
  if (sig !== renderedDeck) {
    renderedDeck = sig;
    list.textContent = "";
    for (const sl of slides) {
      const li = d.createElement("li");
      const b = d.createElement("button");
      b.type = "button";
      b.dataset.index = String(sl.index);
      const n = d.createElement("span");
      n.className = "n";
      n.textContent = String(sl.index + 1);
      b.append(n);
      // textContent, never innerHTML: questions are author-supplied text and
      // this document has no sanitiser (same rule as the notes above).
      b.append(d.createTextNode(sl.title || "Untitled"));
      // Bound per row rather than delegated, because the handler has to survive
      // this list being rebuilt and a document-level listener on a window we
      // re-create would leak one per open.
      b.addEventListener("click", () => jump?.(sl.index));
      li.append(b);
      list.append(li);
    }
  }

  for (const b of Array.from(list.querySelectorAll("button"))) {
    if (Number(b.dataset.index) === s.index) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }
}
