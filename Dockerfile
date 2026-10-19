# syntax=docker/dockerfile:1

# Build API (tsc) + Vite client, then run a slim production image.
# Postgres is provided by Compose (see compose.yaml), not this image.
# Digests: refresh with `docker buildx imagetools inspect <image>:<tag>` (see INSTALL.md / SECURITY.md).

FROM node:24-bookworm@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0 AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
RUN npm ci && npm ci --prefix client

COPY . .
RUN npm run build:all

FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 taskmesh \
  && useradd --uid 10001 --gid taskmesh --home-dir /app --shell /usr/sbin/nologin taskmesh

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
COPY drizzle ./drizzle
COPY docker/entrypoint.sh /app/docker/entrypoint.sh

RUN chmod +x /app/docker/entrypoint.sh \
  && mkdir -p /app/data/uploads /app/data/backups \
  && chown -R taskmesh:taskmesh /app

# Start as root only long enough for entrypoint to chown the data volume, then
# `runuser` drops to uid 10001 (taskmesh) before migrations and `node`.
EXPOSE 3000
ENTRYPOINT ["/app/docker/entrypoint.sh"]
