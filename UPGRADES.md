# Upgrade TaskMesh

Steps for an administrator who already has TaskMesh installed and wants a newer release. First-time setup stays in [INSTALL.md](INSTALL.md).

**Read the GitHub Release for the version you are installing before you change anything.** That page is the changelog. Pay attention to **Breaking Changes**. Schema and environment changes there can stop the app from starting if you skip them.

Releases: [github.com/blackrook-io/taskmesh/releases](https://github.com/blackrook-io/taskmesh/releases)

## This release candidate is for testers

Tag **`v0.95.0-rc1`** is a GitHub **pre-release** of app version **0.95.0**. It is not a stable production release. The in-app Update link ignores pre-releases, so a stable install will not offer this candidate. Check out the tag when you want this build. Tracking `main` moves on to later development after the tag.

Release page: [v0.95.0-rc1](https://github.com/blackrook-io/taskmesh/releases/tag/v0.95.0-rc1)

## Before you start

1. Read that release, especially **Breaking Changes**. This app requires **Node.js 24+** (`engines` in root `package.json`). Node 22 is no longer supported. Install Node.js 24.x from NodeSource (`setup_24.x`) before `npm install` if `node -v` is older than v24.
2. Back up the database and the uploads directory. In the app, use **Settings → Backups**, or follow [INSTALL.md § Backups](INSTALL.md#18-backups) (bare metal) or [INSTALL.md § A.5](INSTALL.md#a5-data-backups-and-updates) (Compose).
3. Leave `.env` and `.env.docker` in place. Git does not replace them. If the release says a variable is now required, edit the file yourself.
4. Keep `UPLOAD_DIR` off hidden directories. Express 5 `res.sendFile` returns 404 when any folder in the absolute path starts with `.` (for example `/home/you/.taskmesh/uploads`). `/var/lib/taskmesh/uploads` and the default `data/uploads` are fine.

This candidate runs migrations through `0086`. On bare metal, enable the PostgreSQL `vector` extension before `npm run db:migrate`. `sudo bash scripts/enable-pgvector.sh` installs the matching `postgresql-<major>-pgvector` package and creates the extension. `sudo bash scripts/enable-pgvector.sh --check` only reports whether it is already active. Docker Compose uses `pgvector/pgvector:pg16` and does not need that script.

If you set `MFA_TOTP_KEY`, `OAUTH_CREDENTIALS_KEY`, or `AI_CREDENTIALS_KEY`, each value must be at least 32 characters or the API will refuse to start. Do not re-run `deploy/install-ubuntu.sh` to upgrade an install that is already serving the site. Saved Mesh layouts for the retired Plan view are removed on migrate.

## Bare metal (systemd + nginx)

From the clone (often `/srv/taskmesh`), as the user that owns the checkout:

```bash
cd /srv/taskmesh
git fetch --tags origin
git checkout v0.95.0-rc1
npm install
npm install --prefix client
npm run db:migrate
npm run build:all
sudo systemctl restart taskmesh
curl -fsS http://127.0.0.1:3000/api/health
```

Expect JSON with `"ok": true`. Then open the site in a browser and sign in.

On a production host where this checkout is the running install, you can use `npm run deploy:prod` after `git checkout` instead of the install, migrate, build, and restart lines. See [INSTALL.md §20](INSTALL.md#20-updating-taskmesh). The development host does not run that production process.

## Docker Compose

From the clone:

```bash
cd taskmesh
git fetch --tags origin
git checkout v0.95.0-rc1
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

The app container runs migrations when it starts. Wait until `app` is healthy, then open `https://127.0.0.1/` (or your published host port). Logs: `docker compose --env-file .env.docker logs -f app`.

## If the upgrade fails

- Migration errors: confirm `DATABASE_URL` (bare metal) or `POSTGRES_PASSWORD` (Compose) still match the database you backed up. Do not point the new checkout at an empty database.
- API will not start and the log mentions `MFA_TOTP_KEY`, `OAUTH_CREDENTIALS_KEY`, or `AI_CREDENTIALS_KEY`: set each configured key to at least 32 characters, then restart. Rotating `AI_CREDENTIALS_KEY`, and which key a restored backup needs, is in [docs/AI_CREDENTIALS.md](docs/AI_CREDENTIALS.md).
- Restore the backup you took in **Before you start**, then check out the previous tag or commit and start the app again.
- More symptoms: [INSTALL.md §21](INSTALL.md#21-troubleshooting) and [INSTALL.md § A.6](INSTALL.md#a6-container-troubleshooting).
