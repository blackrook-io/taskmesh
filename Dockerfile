# syntax=docker/dockerfile:1

# Build API (tsc) + Vite client, then run a slim production image.
# Postgres is provided by Compose (see compose.yaml), not this image.

FROM node:22-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
RUN npm ci && npm ci --prefix client

COPY . .
RUN npm run build:all

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*

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
  && mkdir -p /app/data/uploads /app/data/backups

EXPOSE 3000
ENTRYPOINT ["/app/docker/entrypoint.sh"]
