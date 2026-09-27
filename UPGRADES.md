# Upgrade TaskMesh

Steps for an administrator who already has TaskMesh installed and wants a newer release. First-time setup stays in [INSTALL.md](INSTALL.md).

**Read the GitHub Release for the version you are installing before you change anything.** That page is the changelog. Pay attention to **Breaking Changes**. Schema and environment changes there can stop the app from starting if you skip them.

Releases: [github.com/blackrook-io/taskmesh/releases](https://github.com/blackrook-io/taskmesh/releases)

## 0.5 Beta is for testers

Tag **`v0.50.0-beta`** is a GitHub **pre-release**. It is not a stable production release. The in-app Update link ignores pre-releases, so a stable install will not offer this beta. Check out the tag when you want this build. Tracking `main` moves on to later development after the tag.

Release page: [v0.50.0-beta](https://github.com/blackrook-io/taskmesh/releases/tag/v0.50.0-beta)

## Before you start

1. Read that release, especially **Breaking Changes**.
2. Back up the database and the uploads directory. In the app, use **Settings → Backups**, or follow [INSTALL.md § Backups](INSTALL.md#18-backups) (bare metal) or [INSTALL.md § A.5](INSTALL.md#a5-data-backups-and-updates) (Compose).
3. Leave `.env` and `.env.docker` in place. Git does not replace them. If the release says a variable is now required, edit the file yourself.

On the 0.5 Beta line, migrations run through `0046`. If you set `MFA_TOTP_KEY` or `OAUTH_CREDENTIALS_KEY`, each value must be at least 32 characters or the API will refuse to start. Do not re-run `deploy/install-ubuntu.sh` to upgrade an install that is already serving the site.

## Bare metal (systemd + nginx)

From the clone (often `/srv/taskmesh`), as the user that owns the checkout:

```bash
cd /srv/taskmesh
git fetch --tags origin
git checkout v0.50.0-beta
npm install
npm install --prefix client
npm run db:migrate
npm run build:all
sudo systemctl restart taskmesh
curl -fsS http://127.0.0.1:3000/api/health
```

Expect JSON with `"ok": true`. Then open the site in a browser and sign in.

If this machine is the one you develop on, and Dev and Prod share the same checkout, you can use `npm run deploy:prod` after `git checkout` instead of the install, migrate, build, and restart lines. See [INSTALL.md §20](INSTALL.md#20-updating-taskmesh).

## Docker Compose

From the clone:

```bash
cd taskmesh
git fetch --tags origin
git checkout v0.50.0-beta
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

The app container runs migrations when it starts. Wait until `app` is healthy, then open `https://127.0.0.1/` (or your published host port). Logs: `docker compose --env-file .env.docker logs -f app`.

## If the upgrade fails

- Migration errors: confirm `DATABASE_URL` (bare metal) or `POSTGRES_PASSWORD` (Compose) still match the database you backed up. Do not point the new checkout at an empty database.
- API will not start and the log mentions `MFA_TOTP_KEY` or `OAUTH_CREDENTIALS_KEY`: set each configured key to at least 32 characters, then restart.
- Restore the backup you took in **Before you start**, then check out the previous tag or commit and start the app again.
- More symptoms: [INSTALL.md §21](INSTALL.md#21-troubleshooting) and [INSTALL.md § A.6](INSTALL.md#a6-container-troubleshooting).
