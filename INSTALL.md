# Install TaskMesh on Ubuntu (bare metal)

Start-to-finish guide for installing TaskMesh on a **fresh Ubuntu Linux server** (same host for PostgreSQL, Node.js API, and the React SPA). Validated against Ubuntu **22.04 / 24.04** style `apt` workflows; adjust package names only if your release differs.

TaskMesh is a **single-user, private-network** app: no auth in this build. Prefer binding to localhost and reaching it over **SSH**, or a private LAN firewall — not a public internet exposure without additional hardening.

---

## Table of contents

1. [What you will install](#1-what-you-will-install)
2. [Reference documentation](#2-reference-documentation)
3. [Server prerequisites](#3-server-prerequisites)
4. [Base system packages](#4-base-system-packages)
5. [Install PostgreSQL](#5-install-postgresql)
6. [Create the TaskMesh database and role](#6-create-the-taskmesh-database-and-role)
7. [Install Node.js](#7-install-nodejs)
8. [Clone the repository](#8-clone-the-repository)
9. [Configure environment variables](#9-configure-environment-variables)
10. [Install npm dependencies](#10-install-npm-dependencies)
11. [Run database migrations](#11-run-database-migrations)
12. [Development run (API + Vite UI)](#12-development-run-api--vite-ui)
13. [Production build and run](#13-production-build-and-run)
14. [Optional: systemd service](#14-optional-systemd-service)
15. [Optional: firewall (UFW)](#15-optional-firewall-ufw)
16. [Optional: access from your laptop (SSH tunnel)](#16-optional-access-from-your-laptop-ssh-tunnel)
17. [Backups](#17-backups)
18. [Verify the install](#18-verify-the-install)
19. [Updating TaskMesh](#19-updating-taskmesh)
20. [Troubleshooting](#20-troubleshooting)

---

## 1. What you will install

| Component | Role |
|-----------|------|
| **PostgreSQL** | Primary datastore (projects, ideas, tasks, boards, wiki, canvases, …) |
| **Node.js + npm** | Runs the Express API and builds the Vite + React client |
| **git** | Clone and update this repository |
| **build-essential** | Native module builds some npm packages may need |
| **TaskMesh** | Express API (`src/`) + SPA (`client/`); uploads under `data/uploads/` by default |

Minimum runtime: **Node.js 20+** (`engines` in root `package.json`). This guide installs **Node.js 22.x** from NodeSource (current Active LTS-style track commonly used on servers).

---

## 2. Reference documentation

Use these official docs alongside the commands below:

| Topic | Link |
|-------|------|
| Ubuntu Server guide | https://ubuntu.com/server/docs |
| `apt` package management | https://ubuntu.com/server/docs/package-management |
| PostgreSQL (Ubuntu packages) | https://ubuntu.com/server/docs/databases-postgresql |
| PostgreSQL official docs | https://www.postgresql.org/docs/current/ |
| `pg_hba.conf` authentication | https://www.postgresql.org/docs/current/auth-pg-hba-conf.html |
| `pg_dump` / restore | https://www.postgresql.org/docs/current/app-pgdump.html |
| `~/.pgpass` | https://www.postgresql.org/docs/current/libpq-pgpass.html |
| Node.js downloads / releases | https://nodejs.org/en/download |
| NodeSource Node.js apt distributions | https://github.com/nodesource/distributions |
| Drizzle ORM | https://orm.drizzle.team/docs/overview |
| Drizzle Kit migrations | https://orm.drizzle.team/docs/kit-overview |
| Express | https://expressjs.com/ |
| Vite | https://vite.dev/guide/ |
| React | https://react.dev/ |
| systemd unit files | https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html |
| UFW firewall | https://ubuntu.com/server/docs/firewall |
| OpenSSH client (`ssh -L`) | https://manpages.ubuntu.com/manpages/noble/en/man1/ssh.1.html |
| tmux (optional long sessions) | https://github.com/tmux/tmux/wiki |
| TaskMesh GitHub repo | https://github.com/blackrook-io/taskmesh |
| Excalidraw (canvas editor, MIT) | https://github.com/excalidraw/excalidraw |

---

## 3. Server prerequisites

- A machine running **Ubuntu Server** (or Ubuntu desktop) with `sudo`
- Network access to install packages (`apt`) and clone from GitHub (or copy the tree another way)
- Disk space for Node modules, Postgres data, and uploads (plan for growth under `data/uploads/`)
- A non-root user with sudo is recommended for day-to-day work

Check the OS:

```bash
lsb_release -a
uname -m
```

---

## 4. Base system packages

Update indexes and install tools used by the rest of this guide:

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates \
  curl \
  git \
  build-essential \
  postgresql \
  postgresql-contrib
```

References: [Ubuntu package management](https://ubuntu.com/server/docs/package-management), [PostgreSQL on Ubuntu](https://ubuntu.com/server/docs/databases-postgresql).

---

## 5. Install PostgreSQL

If you installed packages in §4, PostgreSQL is already present. Enable and start it:

```bash
sudo systemctl enable --now postgresql
sudo systemctl status postgresql --no-pager
```

Confirm the server listens locally (default port **5432**):

```bash
sudo ss -tlnp | grep 5432 || sudo netstat -tlnp | grep 5432
sudo -u postgres psql -c "SELECT version();"
```

References: [PostgreSQL docs](https://www.postgresql.org/docs/current/), [Ubuntu PostgreSQL](https://ubuntu.com/server/docs/databases-postgresql).

---

## 6. Create the TaskMesh database and role

Pick a **strong password** and use it consistently in Postgres and in `.env` (`DATABASE_URL`).

```bash
sudo -u postgres psql -c "CREATE USER taskmesh WITH PASSWORD 'your-secure-password';"
sudo -u postgres psql -c "CREATE DATABASE taskmesh OWNER taskmesh;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE taskmesh TO taskmesh;"
```

On **PostgreSQL 15+**, grant rights on the `public` schema so Drizzle migrations can create tables:

```bash
sudo -u postgres psql -d taskmesh -c "GRANT ALL ON SCHEMA public TO taskmesh;"
sudo -u postgres psql -d taskmesh -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO taskmesh;"
```

Smoke-test the login (you will be prompted for the password unless `PGPASSWORD` / `.pgpass` is set):

```bash
psql -h 127.0.0.1 -U taskmesh -d taskmesh -c "SELECT current_user, current_database();"
```

Using **`127.0.0.1`** instead of `localhost` avoids some IPv6 / socket quirks on Ubuntu.

References: [`CREATE ROLE`](https://www.postgresql.org/docs/current/sql-createrole.html), [`CREATE DATABASE`](https://www.postgresql.org/docs/current/sql-createdatabase.html), [auth / `pg_hba.conf`](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html).

---

## 7. Install Node.js

### Recommended: NodeSource 22.x

Follow [NodeSource distributions](https://github.com/nodesource/distributions) (Node.js **22.x**):

```bash
sudo apt-get install -y curl
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
```

Verify (NodeSource’s `nodejs` package includes **npm**):

```bash
node -v
npm -v
```

Expect Node **v22.x** (or at least **v20+** per `package.json` `engines`).

### Alternative: Ubuntu distro packages

Ubuntu’s own `nodejs` package may work if it is ≥ 20, but versions lag. Prefer NodeSource or [nodejs.org](https://nodejs.org/en/download) for a current LTS.

```bash
# Only if you intentionally use distro Node:
sudo apt-get install -y nodejs npm
node -v
```

---

## 8. Clone the repository

```bash
sudo mkdir -p /srv
sudo chown "$USER":"$USER" /srv
cd /srv
git clone https://github.com/blackrook-io/taskmesh.git
cd taskmesh
git status
git rev-parse --short HEAD
```

If the server cannot reach GitHub, copy the project tree another way (rsync, archive) into e.g. `/srv/taskmesh` and continue from that directory.

Reference: [TaskMesh on GitHub](https://github.com/blackrook-io/taskmesh).

---

## 9. Configure environment variables

```bash
cd /srv/taskmesh
cp .env.example .env
nano .env   # or vim / your editor
```

Minimum production-ready `.env`:

```env
DATABASE_URL=postgresql://taskmesh:your-secure-password@127.0.0.1:5432/taskmesh
PORT=3000
```

Optional (from [`.env.example`](.env.example)):

```env
# Absolute path recommended in production
UPLOAD_DIR=/var/lib/taskmesh/uploads
UPLOAD_MAX_BYTES=5242880
```

If you set `UPLOAD_DIR` outside the repo:

```bash
sudo mkdir -p /var/lib/taskmesh/uploads
sudo chown "$USER":"$USER" /var/lib/taskmesh/uploads
```

Do **not** commit `.env` (it is gitignored). Keep the password aligned with the Postgres role from §6.

---

## 10. Install npm dependencies

From the **repository root**:

```bash
cd /srv/taskmesh
npm install
```

Then install the **client** (Vite + React + Excalidraw). Client `postinstall` copies Excalidraw fonts into `client/public/excalidraw-assets/`:

```bash
cd /srv/taskmesh/client
npm install
cd /srv/taskmesh
```

Confirm fonts landed (needed when `EXCALIDRAW_ASSET_PATH` points at `/excalidraw-assets/`):

```bash
ls client/public/excalidraw-assets/fonts | head
```

---

## 11. Run database migrations

Apply SQL under `drizzle/` via Drizzle:

```bash
cd /srv/taskmesh
npm run db:migrate
```

Reference: [Drizzle Kit](https://orm.drizzle.team/docs/kit-overview).

After future schema edits to `src/db/schema.ts` (development):

```bash
npm run db:generate
# review new files under drizzle/
npm run db:migrate
```

---

## 12. Development run (API + Vite UI)

Two processes: Express API on **3000**, Vite on **5173** (Vite proxies `/api` → the API).

```bash
cd /srv/taskmesh
sudo systemctl status postgresql --no-pager
npm run dev:web
```

- UI: http://127.0.0.1:5173/
- API health: http://127.0.0.1:3000/api/health

API-only:

```bash
npm run dev
```

Keep the session alive over SSH with [tmux](https://github.com/tmux/tmux/wiki) if needed:

```bash
sudo apt-get install -y tmux
tmux new -s taskmesh
# inside tmux:
npm run dev:web
# Detach: Ctrl-b then d
# Reattach: tmux attach -t taskmesh
```

---

## 13. Production build and run

Build API (`dist/`) and SPA (`client/dist/`). With `NODE_ENV=production`, Express serves the SPA and `/api/*`.

```bash
cd /srv/taskmesh
npm run build:all
NODE_ENV=production npm start
```

- App: http://127.0.0.1:3000/
- Health: http://127.0.0.1:3000/api/health

For a durable process, use §14 (systemd) rather than a raw SSH session.

---

## 14. Optional: systemd service

Create a unit that runs the production server as your app user (replace `YOUR_USER` and paths if needed):

```bash
sudo tee /etc/systemd/system/taskmesh.service >/dev/null <<'EOF'
[Unit]
Description=TaskMesh (Express + static SPA)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/srv/taskmesh
Environment=NODE_ENV=production
EnvironmentFile=/srv/taskmesh/.env
ExecStart=/usr/bin/node /srv/taskmesh/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

```bash
sudo sed -i "s/YOUR_USER/$USER/" /etc/systemd/system/taskmesh.service
cd /srv/taskmesh
npm run build:all
sudo systemctl daemon-reload
sudo systemctl enable --now taskmesh
sudo systemctl status taskmesh --no-pager
curl -sS http://127.0.0.1:3000/api/health
```

After pulling updates: rebuild, then `sudo systemctl restart taskmesh`.

Reference: [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html).

---

## 15. Optional: firewall (UFW)

For a **private** server that you only reach via SSH, deny public HTTP and rely on an SSH tunnel (§16):

```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status
```

If you intentionally expose the app on a trusted LAN interface:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 3000 proto tcp
# adjust CIDR to your LAN
sudo ufw reload
```

Reference: [Ubuntu UFW](https://ubuntu.com/server/docs/firewall).

---

## 16. Optional: access from your laptop (SSH tunnel)

Keep TaskMesh bound to `127.0.0.1` on the server; forward a local port:

```bash
ssh -L 3000:127.0.0.1:3000 your-user@your-server
```

Then open http://127.0.0.1:3000/ on the laptop (production) or tunnel **5173** similarly for Vite:

```bash
ssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 your-user@your-server
```

Reference: [ssh(1)](https://manpages.ubuntu.com/manpages/noble/en/man1/ssh.1.html) (`-L`).

---

## 17. Backups

TaskMesh can dump **PostgreSQL** and tar **uploads** into `BACKUP_DIR` (default `data/backups/`).

### In-app controls

With the API running, open **Backups** (Home or ⌘K → Backups) at `/settings/backups` to:

- See health of recent backups (healthy if latest successful dump is &lt; 36 hours old)
- **Run backup now**
- **Restore** a backup (confirm dialog; takes a safety dump first, then replaces DB + uploads)
- Edit schedule (local hour/minute + retain days) — applied by the API’s in-process scheduler while the process is up

CLI (same runner):

```bash
cd /srv/taskmesh
npm run backup
```

Schedule file (created/updated by the UI): `data/backup-schedule.json` (see `data/backup-schedule.json.example`). Optional env: `BACKUP_DIR`, `BACKUP_SCHEDULE_PATH` (see [`.env.example`](.env.example)).

### Optional: systemd timer (when the app may be stopped)

Unit templates live in [`deploy/`](deploy/):

```bash
sudo cp /srv/taskmesh/deploy/taskmesh-backup.service /etc/systemd/system/
sudo cp /srv/taskmesh/deploy/taskmesh-backup.timer /etc/systemd/system/
sudo sed -i "s/YOUR_USER/$USER/" /etc/systemd/system/taskmesh-backup.service
# Edit OnCalendar in the timer if needed
sudo systemctl daemon-reload
sudo systemctl enable --now taskmesh-backup.timer
sudo systemctl list-timers | grep taskmesh
```

References: [systemd.timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html), [`pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html).

### Manual PostgreSQL dump / restore

```bash
export PGPASSWORD='your-secure-password'
pg_dump -h 127.0.0.1 -U taskmesh -d taskmesh -F p -f "taskmesh-$(date +%F).sql"
unset PGPASSWORD
```

Restore (**destructive**):

```bash
export PGPASSWORD='your-secure-password'
psql -h 127.0.0.1 -U taskmesh -d taskmesh -f taskmesh-YYYY-MM-DD.sql
unset PGPASSWORD
```

Or restore from a TaskMesh backup folder’s `.sql` file under `BACKUP_DIR/<id>/`.

---

## 18. Verify the install

```bash
curl -sS http://127.0.0.1:3000/api/health
# expect JSON health payload / HTTP 200

# Production UI (after build + start):
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

In a browser: open the UI, create a project, attach an image in Markdown (upload path), and open a canvas (Excalidraw).

---

## 19. Updating TaskMesh

```bash
cd /srv/taskmesh
git pull
npm install
cd client && npm install && cd ..
npm run db:migrate
npm run build:all
sudo systemctl restart taskmesh   # if using systemd
```

Always run migrations after pulling schema changes; review `drizzle/` if you maintain a fork.

---

## 20. Troubleshooting

| Symptom | Things to check |
|---------|-----------------|
| `npm run db:migrate` fails on permissions | Re-run §6 schema grants; confirm `DATABASE_URL` user owns/can write `public` |
| `ECONNREFUSED` on Postgres | `sudo systemctl status postgresql`; host `127.0.0.1` vs `localhost`; password in URL |
| Port 3000 in use | `ss -tlnp \| grep 3000`; change `PORT` in `.env` |
| Blank Excalidraw / missing fonts | Re-run `cd client && npm install`; confirm `client/public/excalidraw-assets/fonts` exists; `index.html` sets `EXCALIDRAW_ASSET_PATH` |
| SPA 404 on refresh in production | Ensure `NODE_ENV=production` and `client/dist/index.html` exists (`npm run build:all`) |
| Client `postinstall` skipped | Run `node client/scripts/copy-excalidraw-assets.mjs` manually from `client/` |

---

## Quick checklist (bare metal)

1. `apt-get update` + install curl, git, build-essential, postgresql  
2. Enable PostgreSQL; create `taskmesh` user + database + schema grants  
3. Install Node.js **22.x** (NodeSource)  
4. Clone repo to `/srv/taskmesh`  
5. Copy `.env.example` → `.env`; set `DATABASE_URL` / `PORT`  
6. `npm install` (root) and `npm install` in `client/`  
7. `npm run db:migrate`  
8. Dev: `npm run dev:web` **or** prod: `npm run build:all` + `NODE_ENV=production npm start` (+ systemd)  
9. Confirm `/api/health` and the UI  
10. Schedule Postgres + uploads backups  
