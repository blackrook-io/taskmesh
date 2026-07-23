# TaskMesh

Personal **projects** and **ideas** with a **React** web UI and **Express** API. Stack: **Node.js**, **TypeScript**, **Vite**, **React**, **Express**, **PostgreSQL**, **Drizzle ORM**.

## Prerequisites

- **Node.js** 20+
- **PostgreSQL** (installed on the same Ubuntu host or reachable from it)

## Ubuntu: PostgreSQL

Install the server and client tooling, then enable the service:

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
sudo systemctl status postgresql
```

Create a database user and database for TaskMesh (pick a strong password in place of `your-secure-password`):

```bash
sudo -u postgres psql -c "CREATE USER taskmesh WITH PASSWORD 'your-secure-password';"
sudo -u postgres psql -c "CREATE DATABASE taskmesh OWNER taskmesh;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE taskmesh TO taskmesh;"
```

On **PostgreSQL 15 and newer**, grant the app user rights on the `public` schema so migrations can create tables:

```bash
sudo -u postgres psql -d taskmesh -c "GRANT ALL ON SCHEMA public TO taskmesh;"
sudo -u postgres psql -d taskmesh -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO taskmesh;"
```

## Ubuntu: Node.js

Example install using NodeSource 20.x:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

## Ubuntu: project setup

Install tooling, clone the repository, and configure the environment:

```bash
sudo apt-get install -y git build-essential
cd /path/you/prefer
git clone <your-repo-url> taskmesh
cd taskmesh
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to match the Postgres user and database you created. Using `127.0.0.1` avoids some IPv6 resolution quirks compared to `localhost`:

```env
DATABASE_URL=postgresql://taskmesh:your-secure-password@127.0.0.1:5432/taskmesh
PORT=3000
```

## Development on the server

1. Ensure PostgreSQL is running: `sudo systemctl status postgresql`
2. Install dependencies and apply migrations:

   ```bash
   npm install
   npm run db:migrate
   ```

3. Start the API with reload:

   ```bash
   npm run dev
   ```

4. Check health: [http://localhost:3000/api/health](http://localhost:3000/api/health)

5. (Optional) Run the **web UI** in a second terminal — Vite proxies `/api` to the API:

   ```bash
   cd taskmesh
   npm install
   cd client && npm install && cd ..
   npm run dev:web
   ```

   Then open [http://localhost:5173](http://localhost:5173) for the SPA (API remains on port **3000**).

### Optional: remote access and long-lived sessions

- **SSH tunnel** from your laptop so the API stays bound on the server:  
  `ssh -L 3000:127.0.0.1:3000 your-user@your-server`  
  Then open `http://localhost:3000/api/health` on the laptop.
- **tmux**, **screen**, or a **systemd** / **pm2** service if you need the process to keep running after you disconnect SSH (use `npm run build:all` and `npm start` for a non-watch production-style run).

## Scripts

| Script                | Description                                      |
|-----------------------|--------------------------------------------------|
| `npm run dev`         | Express API with reload (`tsx watch`)            |
| `npm run dev:client`  | Vite dev server for `client/` (proxies `/api`)   |
| `npm run dev:web`     | API + Vite together (`concurrently`)             |
| `npm run build`       | Compile API TypeScript to `dist/`                 |
| `npm run build:client`| Production build of the SPA to `client/dist/`     |
| `npm run build:all`   | `build` + `build:client`                          |
| `npm start`           | Run compiled API (`node dist/index.js`)           |
| `npm run db:generate` | Create SQL migrations from `src/db/schema.ts`   |
| `npm run db:migrate`  | Apply migrations in `./drizzle` to the database |
| `npm run db:studio`   | Drizzle Studio (inspect DB)                      |

For production on one host, build both artifacts and run Node with `NODE_ENV=production` so Express serves `client/dist` and the SPA fallback for client-side routes:

```bash
npm run build:all
NODE_ENV=production npm start
```

Open `http://localhost:3000/` for the UI; API routes remain under `/api/...`.

After changing `src/db/schema.ts`, run `npm run db:generate`, review the new SQL under `drizzle/`, then `npm run db:migrate`.

## Backups (PostgreSQL)

Dump the database from the Ubuntu host (set `PGPASSWORD` for non-interactive use, or use a [`~/.pgpass`](https://www.postgresql.org/docs/current/libpq-pgpass.html) file):

```bash
export PGPASSWORD='your-secure-password'
pg_dump -h 127.0.0.1 -U taskmesh -d taskmesh -F p -f backup.sql
unset PGPASSWORD
```

Restore overwrites data in the target database — use with care:

```bash
export PGPASSWORD='your-secure-password'
psql -h 127.0.0.1 -U taskmesh -d taskmesh -f backup.sql
unset PGPASSWORD
```

For production, automate `pg_dump` (or vendor snapshots) to durable storage on a schedule.

Uploaded images are stored on disk under `data/uploads/` by default (override with `UPLOAD_DIR` in `.env`). Include that directory in backups alongside the database.

## Project layout

```
client/          # Vite + React SPA
  dist/          # Production static assets (after npm run build:client)
src/
  index.ts       # Express entry
  routes/v1/     # REST API
  db/
    schema.ts    # Drizzle schema
    client.ts    # Pool + db instance
    migrate.ts   # Migration runner (used by npm run db:migrate)
drizzle/         # Generated SQL migrations + meta
data/uploads/    # Image uploads (created at runtime; tracked with .gitkeep)
```

## License

Private / unspecified — add a `LICENSE` when you decide.
