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
}

let win: Window | null = null;

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
</style></head><body>
  <div class="bar">
    <span>Slide <b id="pos">–</b></span>
    <span><b id="people">0</b> joined</span>
    <span><b id="answered">0</b> answered</span>
  </div>
  <h1 id="q"></h1>
  <div class="notes" id="notes"></div>
  <p class="next" id="next"></p>
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
}
