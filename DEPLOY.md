# Deployment Guide

Frontend → **GitHub Pages** (free, always on). Database → **Neon** (free
serverless Postgres, no card). Backend server → **Render** (free web service,
no card). Both Neon and Render "sleep" after a few minutes of no traffic and
auto-wake on the next request — no manual intervention, just a small delay
(seconds for Neon, up to ~30-60s for Render) for whoever's first after an idle
period. This trio needs **no credit card anywhere**.

> Considered Oracle Cloud's Always Free VM instead (genuinely zero cold-start,
> since it's a real always-on VM) — it requires a credit card for identity
> verification even though it's never actually charged on Always Free
> resources. If that trade-off changes later, `server/ecosystem.config.cjs`
> and `server/deploy/nginx.conf.template` are still in the repo for that path.

---

## Part A — Push this project to GitHub ✅ done

Already live at `https://snehee-c.github.io/QuizApp/` via
`.github/workflows/deploy-frontend.yml`. Nothing more to do here except set
`VITE_API_URL` once Render is up (Part D).

---

## Part B — Create the Neon database

1. Sign up at [neon.tech](https://neon.tech) with GitHub or email — no card.
2. **Create a project** (any name, e.g. `mentimeter`).
3. On the project dashboard, copy the **connection string** — looks like:
   ```
   postgresql://<user>:<password>@<host>.neon.tech/<db>?sslmode=require
   ```
4. Send me that connection string and I'll run the migrations against it directly (I don't need your Neon login for this — just that one connection string, and only to run `prisma migrate deploy`).

---

## Part C — Deploy the backend on Render

1. Sign up at [render.com](https://render.com) with GitHub — no card.
2. **New → Web Service** → connect the `QuizApp` GitHub repo.
3. Configure:
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Environment variables** (Environment tab):
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from Part B |
   | `JWT_SECRET` | any long random string (e.g. generate one at [random.org/strings](https://www.random.org/strings/) or just mash the keyboard for 40+ chars) |
   | `CLIENT_ORIGIN` | `https://snehee-c.github.io` |
   
   (`PORT` is set automatically by Render — don't add it.)
5. **Create Web Service.** Render will build and deploy; watch the logs. First deploy takes a few minutes.
6. Once live, note the public URL Render gives you — looks like `https://quizapp-xxxx.onrender.com`.
7. Verify: open `https://quizapp-xxxx.onrender.com/api/health` — should return `{"ok":true,...}`.

---

## Part D — Wire the frontend to the backend

On GitHub: repo **Settings → Secrets and variables → Actions → Variables → New repository variable**:

- Name: `VITE_API_URL`
- Value: `https://quizapp-xxxx.onrender.com` (your actual Render URL from Part C)

Then **Actions tab → "Deploy frontend to GitHub Pages" → Run workflow** to rebuild with that value baked in.

---

## Verifying end to end

1. Open `https://snehee-c.github.io/QuizApp/`.
2. Sign up, create a presentation, add a slide.
3. Click **Present** — the join code should appear.
4. On your phone (any network — this is the real internet now, not local WiFi), go to the same URL and join with the code.
5. Confirm votes show up live.

If the very first load after a while feels slow or briefly fails, that's Render waking up from sleep (up to ~60s) — refresh after a moment.

---

## Updating the deployed app later

- **Frontend:** push to `main` → GitHub Actions redeploys automatically.
- **Backend:** push to `main` → Render redeploys automatically (auto-deploy is on by default for the connected branch). Migrations run automatically too, since the build command includes `prisma migrate deploy`.

---

## Local dev

Unchanged — still Postgres via Docker, separate from the Neon production database:

```bash
docker compose up -d          # starts local Postgres (see docker-compose.yml)
cd server
npx prisma migrate dev        # first time only, creates the schema
npm run dev
```

---

## Appendix: self-hosting on Oracle Cloud instead

If you'd rather have a real always-on VM with zero cold-start (trading a
one-time card-verification step for that), the original plan is preserved:
`server/ecosystem.config.cjs` (PM2 process config) and
`server/deploy/nginx.conf.template` (reverse proxy + WebSocket upgrade
headers) are ready to use. Ask and I'll walk through VM provisioning, Nginx,
and Certbot setup the same way.
