# Mentimeter Clone — Build Plan

A plan to build a real-time audience interaction / live polling app (a "Mentimeter clone").

> **Decisions locked in:**
> - **Stack A** — React + Vite + TypeScript · Node + Express + Socket.IO · PostgreSQL + Prisma. (Self-hostable, no vendor lock-in.)
> - **Build local-first.** Get every part working on your laptop before touching deployment.
> - **Deploy target (later):** frontend on **GitHub Pages** (free, always on), backend + DB on an **Oracle Cloud "Always Free" VM** (free forever, no usage caps, runs when your laptop is off).
> - **Bonus:** the same app can run fully offline over local WiFi at an event (see §11).

## Build status (updated 2026-07-24)

**Working locally right now**, verified end-to-end with automated tests (auth -> create presentation -> add slides -> run a live session -> vote -> see live results):

- DONE **Phase 0** - `client/` (Vite React TS + Tailwind) and `server/` (Express + Socket.IO + Prisma) scaffolded. Using **SQLite** for local dev (zero-setup, no Docker/daemon needed - Docker wasn't running on this machine). Swap to Postgres by changing the Prisma provider when deploying.
- DONE **Phase 1** - JWT auth (signup/login), presentation + slide CRUD, full editor UI for all 4 slide types.
- DONE **Phase 2** - Real-time core: Socket.IO rooms keyed by join code, session lobby -> live slide broadcast -> live vote aggregation. Confirmed working with a scripted presenter+participant test.
- DONE **Phase 3** - All 4 question types working end-to-end: multiple choice (bar chart), word cloud, scale/rating (average + distribution), open-ended (text feed).
- IN PROGRESS **Phase 4** - Done: QR code + join link, full-screen present mode, duplicate-vote prevention (participant re-vote overwrites via upsert, confirmed by test), CSV export of session results. Not yet done: explicit reconnect/resume UX polish (join is idempotent so it mostly works already, just not stress-tested), rate limiting.
- NOT STARTED **Phase 5** - Nice-to-haves (quiz mode, themes, templates).
- NOT STARTED **Phase 6** - Deployment (GitHub Pages + Oracle Cloud VM) - do this once you're happy with local behavior.

### How to run it locally
```
# Terminal 1
cd server
npm run dev        # http://localhost:3000

# Terminal 2
cd client
npm run dev         # http://localhost:5173 (also reachable on your LAN IP for phone testing)
```
Sign up as a presenter at `/login`, create a presentation, add slides, hit **Present**, and join from your phone at `/join` using the code shown (same WiFi network).

---

## 0. Guiding principle: LOCAL FIRST

Everything in Phases 0–4 runs entirely on your laptop — no cloud, no accounts, no internet needed for dev. You only deploy (Phase 6) once it all works locally.

Local dev setup:
- Frontend runs at `http://localhost:5173` (Vite dev server).
- Backend runs at `http://localhost:3000` (Express + Socket.IO).
- Postgres runs locally (Docker container, or Postgres installed on Windows).
- To test on your **phone** over your home WiFi, use your laptop's LAN IP (e.g. `http://192.168.1.20:5173`) — no internet required, just same WiFi.

---

## 1. What we're building

A web app where a **presenter** creates presentations made of question slides, and an **audience** joins with a code (or QR) from their phones to respond live. Results update on the presenter's screen in real time.

### Core user roles
- **Presenter** — signs in, builds presentations, runs live sessions, sees aggregated results.
- **Participant** — joins anonymously via a room code, no account needed, submits answers.

### MVP question types (start with 3–4)
1. **Multiple choice** — bar chart of votes.
2. **Word cloud** — free-text words sized by frequency.
3. **Scales / rating** — 1–5 (or 1–10) average.
4. **Open-ended (Q&A)** — text responses shown as a feed.

Later: ranking, pin-on-image, quiz mode with scoring/leaderboard, 100-points allocation, guess-the-number.

---

## 2. Tech stack (locked)

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **React + Vite + TypeScript** | Fast dev, component model fits slides |
| Styling | **Tailwind CSS** | Quick, consistent UI |
| Charts | **Recharts** (bar/pie) + **D3** (word cloud) | Live-updating results |
| Backend | **Node.js + Express** | Simple REST + easy WebSocket integration |
| Real-time | **Socket.IO (WebSockets)** | The heart of the app — live vote push |
| Database | **PostgreSQL** + **Prisma ORM** | Relational: users → presentations → slides → responses |
| Auth | **JWT** (email + password) | Presenter accounts only |
| QR / codes | **qrcode** npm package | Join-by-QR |
| Local DB | **Docker** (postgres image) | One command to run Postgres locally |

*Why not Supabase/Firebase:* their free tiers have usage caps, which conflicts with the "free, no limits" goal. A plain Node + Postgres app self-hosts on any free VM with no caps.

---

## 3. Data model

```
User (presenter)
  id, email, passwordHash, name, createdAt

Presentation
  id, ownerId → User, title, createdAt, updatedAt

Slide (a question)
  id, presentationId → Presentation, order,
  type (MULTIPLE_CHOICE | WORD_CLOUD | SCALE | OPEN_ENDED),
  question (text),
  config (JSON: options[], scaleMin, scaleMax, allowMultiple, etc.)

Session (a live run of a presentation)
  id, presentationId → Presentation, joinCode (e.g. 6 digits),
  status (LOBBY | ACTIVE | ENDED), currentSlideId, startedAt

Response
  id, sessionId → Session, slideId → Slide,
  participantId (anon uuid), value (JSON), createdAt
```

Key idea: **responses are tied to a Session**, so one presentation can be reused for multiple audiences with separate results.

---

## 4. Real-time architecture

Use Socket.IO rooms keyed by `joinCode`.

**Presenter → server:** `session:create`, `session:next-slide` / `prev-slide`, `session:show-results`, `session:end`
**Participant → server:** `session:join { joinCode }` (validate + join room + get current slide), `response:submit { slideId, value }`
**Server → room (broadcast):** `slide:changed { slide }`, `results:updated { slideId, aggregate }`, `participant:count { n }`

**Aggregation:** keep a running tally per slide server-side, persist each Response to the DB, and push the *aggregate* (not raw responses) to the presenter to keep payloads small.

---

## 5. Screens / UI

**Presenter:** login/signup → dashboard → editor (add/reorder slides, pick type) → present view (question + live chart + join code/QR + headcount + next/prev) → results/export.
**Participant (mobile-first):** join by code (or QR link `/join/CODE`) → lobby → answer screen (input per question type) → "waiting for next question".

---

## 6. Build phases (all local until Phase 6)

### Phase 0 — Local setup (½–1 day)
- Repo with `client/` + `server/` folders.
- `client/`: Vite React TS app + Tailwind.
- `server/`: Express + Socket.IO + Prisma.
- Postgres via Docker (`docker run postgres` or a `docker-compose.yml`).
- Prisma schema from §3 + first migration.
- Verify: frontend loads, backend responds to a health check, DB connects.

### Phase 1 — Editor + data (2–3 days)
- Auth (signup/login, JWT).
- CRUD for presentations and slides.
- Editor UI — multiple-choice slides only, with live preview.
- Persist to local Postgres.

### Phase 2 — Real-time core (3–4 days) ⭐ hardest + most important
- Socket.IO server + rooms.
- Session create → joinCode.
- Participant join flow (no auth).
- Presenter next/prev slide broadcast.
- Submit multiple-choice response → live bar chart on presenter screen.
- **Vertical slice: one question type working end-to-end before adding more.**
- Test with your phone over home WiFi (laptop LAN IP).

### Phase 3 — More question types (2–3 days)
- Word cloud (D3 layout), scale/rating (average + distribution), open-ended Q&A feed.

### Phase 4 — Polish (2–3 days)
- QR code + shareable join link + lobby screen.
- Present mode full-screen styling + transitions.
- Reconnect handling (refresh keeps participant in session).
- Duplicate-vote prevention (localStorage `participantId`, one response per participant+slide).
- CSV export of results.

### Phase 5 — Nice-to-haves (ongoing)
- Quiz mode (timers, scoring, leaderboard), themes/branding, templates, cross-session analytics, rate limiting.

### Phase 6 — Deployment (do this LAST, §7)

---

## 7. Deployment (free, no limits, always on) — Phase 6

Both halves stay up when your laptop is off, cost nothing, and have no usage caps.

### 7a. Frontend → GitHub Pages
- `npm run build` produces static files; publish to GitHub Pages.
- Free, always on, effectively unlimited for static hosting.
- Point the frontend at the backend's public URL (Oracle VM) via an env variable.

### 7b. Backend + DB → Oracle Cloud "Always Free" VM
- A real VM, free **forever** (not a trial): up to 4 ARM cores + 24 GB RAM.
- No monthly bill, no vendor usage caps, runs 24/7 independent of your laptop.
- Setup outline:
  1. Create the Always Free VM (Ubuntu).
  2. Install Node, and Postgres (or run it in Docker on the VM).
  3. Clone the repo, set env vars, run Prisma migrations.
  4. Run the server under **PM2** (auto-restart, starts on boot).
  5. Put **Nginx** in front + **HTTPS** via Let's Encrypt (Certbot) — needed so phones on the internet can connect securely and WebSockets work.
  6. Open the firewall ports (Oracle security list + Ubuntu ufw).
- Only "limit" is the hardware — comfortably handles hundreds of concurrent voters.

**Trade-off:** you manage the VM yourself (initial setup + occasional updates). That's the cost of "free with no limits."

---

## 8. Folder structure

```
mentimeter/
├── client/                 # React + Vite (→ GitHub Pages)
│   └── src/
│       ├── presenter/      # dashboard, editor, present view
│       ├── participant/    # join, answer screens
│       ├── components/     # charts, slide renderers
│       ├── hooks/          # useSocket, useSession
│       └── lib/            # api + socket clients
├── server/                 # Node + Express + Socket.IO (→ Oracle VM)
│   └── src/
│       ├── routes/         # REST: auth, presentations, slides
│       ├── sockets/        # socket event handlers
│       ├── services/       # aggregation, session manager
│       └── prisma/         # schema + migrations
├── docker-compose.yml      # local Postgres
└── PLAN.md
```

---

## 9. Key challenges to plan for

- **Late joiners** — send current slide + state on `join`.
- **Duplicate/spam votes** — client-generated `participantId` (localStorage), enforce one response per (participant, slide).
- **Reconnection** — Socket.IO auto-reconnects; make join idempotent, re-sync on reconnect.
- **Tally race conditions** — one aggregation source of truth (atomic DB increments or in-memory tally).
- **Presenter disconnect** — keep session state server-side so a brief drop doesn't kill the session.
- **Concurrent connections** — one server is fine for hundreds. To scale further, add a Redis adapter for Socket.IO.

---

## 10. First concrete steps (Phase 0)

1. `npm create vite@latest client -- --template react-ts`
2. Scaffold `server/` with Express + Socket.IO + Prisma.
3. Add `docker-compose.yml` for local Postgres; start it.
4. Define the Prisma schema (§3), run the first migration.
5. Build the **Phase 2 vertical slice** (one multiple-choice question, live) before anything else — it de-risks the whole project.

---

## 11. Offline / local-event fallback (no internet at all)

The same codebase can run with **zero internet** at a venue — useful if WiFi has no uplink:
- Run `server/` + Postgres on a laptop (or mini-PC) at the venue.
- Everyone connects to the venue's local WiFi and opens the laptop's **LAN IP** (e.g. `http://192.168.1.20:5173`).
- Show a QR code pointing at that LAN URL so phones join instantly.
- No cloud, no internet — just the local network.

This is the same setup you already use for local dev testing, so you get it for free.

---

*Start small: one question type, working live on your laptop, end-to-end. Deploy only after it all works locally.*
