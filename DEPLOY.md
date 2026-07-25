# Deployment Guide

Frontend → **GitHub Pages** (free, always on). Backend + Postgres → an **Oracle
Cloud "Always Free" VM** (free forever, always on, no usage caps).

> **Important gotcha:** GitHub Pages serves over HTTPS. Browsers block a HTTPS
> page from calling an HTTP-only backend ("mixed content"), so the backend
> **must** have a real HTTPS certificate — a bare IP address won't work with
> Let's Encrypt. We use **nip.io**, a free wildcard DNS service that maps
> `<your-vm-ip>.nip.io` → your VM's IP with zero signup, so Certbot can issue
> a real cert without you buying a domain.

---

## Part A — Push this project to GitHub

1. Create a new **empty** repository on GitHub (no README/license — this project already has files). Note its name; the deploy workflow uses it automatically.
2. In this project folder:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions**. The workflow at `.github/workflows/deploy-frontend.yml` will then build and deploy `client/` automatically on every push to `main`.
4. Your site will appear at `https://<you>.github.io/<repo>/` once the Action finishes (check the **Actions** tab).

You can do this now — it'll deploy successfully, it just won't be able to reach a backend yet until Part B is done and `VITE_API_URL` is set (Part C).

---

## Part B — Create the Oracle Cloud Always Free VM

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) (needs a credit card for identity verification, but the Always Free tier genuinely never bills unless you explicitly upgrade).
2. Console → **Compute → Instances → Create Instance**.
   - Name: `mentimeter-server`
   - Image: **Ubuntu 22.04** (or latest LTS)
   - Shape: click "Change shape" → **Ampere (ARM), VM.Standard.A1.Flex** → this is the "Always Free" shape (up to 4 OCPUs / 24GB RAM free). x86 "Micro" shapes are also Always Free but much smaller — Ampere is the better free option.
   - Add your SSH public key (or let Oracle generate a key pair — download the private key).
   - Create.
3. Note the instance's **public IP address**.
4. Open the firewall: Console → your instance → **Subnet → Security Lists → Default Security List → Add Ingress Rules**:
   - Source `0.0.0.0/0`, port `80` (HTTP)
   - Source `0.0.0.0/0`, port `443` (HTTPS)
   - (port 22/SSH is open by default)
5. SSH in: `ssh -i /path/to/key ubuntu@<vm-public-ip>`
6. **Also open the OS-level firewall** (Ubuntu ships with `iptables` rules from Oracle's image that block ports even after the console rule is added):
   ```
   sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

---

## Part C — Set up the VM

SSH'd into the VM:

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Postgres
sudo apt-get install -y postgresql
sudo -u postgres psql -c "CREATE USER menti WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE mentimeter OWNER menti;"

# PM2 (process manager) + Nginx + Certbot
sudo npm install -g pm2
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Clone your repo
git clone https://github.com/<you>/<repo>.git
cd <repo>/server
npm ci
```

Create `server/.env` on the VM (production values — do **not** commit this file):

```
DATABASE_URL="postgresql://menti:CHANGE_ME_STRONG_PASSWORD@localhost:5432/mentimeter"
JWT_SECRET="<generate with: openssl rand -hex 32>"
PORT=3000
CLIENT_ORIGIN="https://<you>.github.io"
```

Build and run migrations, then start under PM2:

```bash
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 start ecosystem.config.cjs
pm2 startup    # follow the printed instructions (runs a sudo command once)
pm2 save       # persists the process list so it survives a reboot
```

### Nginx + HTTPS

Your free hostname is `<vm-public-ip>.nip.io` (dots in the IP stay as dots, e.g. `123.45.67.89.nip.io`).

```bash
sudo cp ~/<repo>/server/deploy/nginx.conf.template /etc/nginx/sites-available/mentimeter
sudo sed -i 's/YOUR_DOMAIN/<vm-public-ip>.nip.io/' /etc/nginx/sites-available/mentimeter
sudo ln -s /etc/nginx/sites-available/mentimeter /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d <vm-public-ip>.nip.io
# follow prompts; certbot edits the Nginx config in place to add HTTPS + redirect
```

Verify: `https://<vm-public-ip>.nip.io/api/health` should return `{"ok":true,...}`.

---

## Part D — Wire the frontend to the backend

On GitHub: repo **Settings → Secrets and variables → Actions → Variables → New repository variable**:

- Name: `VITE_API_URL`
- Value: `https://<vm-public-ip>.nip.io`

Re-run the "Deploy frontend to GitHub Pages" workflow (Actions tab → select it → **Run workflow**), or just push any change to `client/`. The rebuilt site will now point at your live backend.

---

## Verifying end to end

1. Open `https://<you>.github.io/<repo>/`.
2. Sign up, create a presentation, add a slide.
3. Click **Present** — the join code should appear.
4. On your phone (any network — this is now the real internet, not local WiFi), go to the same URL and join with the code.
5. Confirm votes show up live.

---

## Updating the deployed app later

- **Frontend:** push to `main` → GitHub Actions redeploys automatically.
- **Backend:** on the VM:
  ```bash
  cd ~/<repo>
  git pull
  cd server
  npm ci
  npx prisma migrate deploy   # only does something if the schema changed
  npm run build
  pm2 restart mentimeter-server
  ```

---

## Local dev after this change

Local dev now uses Postgres (matching production) instead of SQLite. Start it with Docker:

```bash
docker compose up -d          # starts local Postgres (see docker-compose.yml)
cd server
npx prisma migrate dev        # first time only, creates the schema
npm run dev
```
