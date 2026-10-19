#!/usr/bin/env bash
# Enable the pgvector extension for TaskMesh on a bare-metal (systemd) host.
#
# Run this BEFORE `npm run db:migrate` when upgrading to a release that adds
# the knowledge index (migration 0069 runs `CREATE EXTENSION IF NOT EXISTS vector`).
# The taskmesh database role cannot create extensions, so the migration fails
# unless the extension already exists in the database.
#
# What it does (safe to run more than once):
#   1. Reads the database name from DATABASE_URL in /srv/taskmesh/.env.
#   2. Detects the running PostgreSQL major version.
#   3. Installs postgresql-<major>-pgvector, refusing if apt would pull in a
#      second PostgreSQL server (version mismatch).
#   4. Creates the extension in the TaskMesh database as the postgres superuser.
#
# It does not restart PostgreSQL or TaskMesh, and it does not run migrations.
# Docker Compose installs do not need it: the db image already includes pgvector.
#
# Usage:
#   sudo bash scripts/enable-pgvector.sh            # install and enable
#   sudo bash scripts/enable-pgvector.sh --check    # report only, change nothing
#   APP_ROOT=/other/path sudo -E bash scripts/enable-pgvector.sh

set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/taskmesh}"
ENV_FILE="${APP_ROOT}/.env"
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (use --check or --help)" >&2; exit 2 ;;
  esac
done

info() { printf '  %s\n' "$*"; }
ok()   { printf '✔ %s\n' "$*"; }
die()  { printf '✘ %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run with sudo: sudo bash $0 $*"
command -v psql >/dev/null || die "psql not found. Is PostgreSQL installed on this host?"
command -v apt-get >/dev/null || die "apt-get not found. This script is for Ubuntu/Debian hosts."

as_postgres() { (cd / && sudo -u postgres "$@"); }

# --- 1. Database name from DATABASE_URL -------------------------------------
[[ -r "$ENV_FILE" ]] || die "Cannot read ${ENV_FILE}. Set APP_ROOT if TaskMesh lives elsewhere."
db_url="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"'')"
[[ -n "$db_url" ]] || die "DATABASE_URL not found in ${ENV_FILE}."
db_name="${db_url##*/}"      # text after the last slash
db_name="${db_name%%\?*}"    # drop any ?query
[[ "$db_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Unexpected database name '${db_name}' in DATABASE_URL."
ok "TaskMesh database: ${db_name}"

as_postgres psql -tAc "SELECT 1" >/dev/null 2>&1 || die "Cannot connect as postgres. Is the PostgreSQL service running?"
[[ "$(as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'")" == "1" ]] \
  || die "Database '${db_name}' does not exist on this server."

# --- 2. Server major version ------------------------------------------------
ver_num="$(as_postgres psql -tAc 'SHOW server_version_num' | tr -d '[:space:]')"
major=$(( ver_num / 10000 ))
(( major >= 13 )) || die "PostgreSQL ${major} is too old for current pgvector packages."
pkg="postgresql-${major}-pgvector"
ok "PostgreSQL server major version: ${major} (package ${pkg})"

# Already enabled? Then there is nothing to do.
current="$(as_postgres psql -d "$db_name" -tAc "SELECT extversion FROM pg_extension WHERE extname='vector'" | tr -d '[:space:]')"
if [[ -n "$current" ]]; then
  ok "vector ${current} is already enabled in ${db_name}. Nothing to do."
  info "Next: npm run db:migrate"
  exit 0
fi

# --- 3. Package -------------------------------------------------------------
if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
  ok "${pkg} is already installed."
else
  candidate="$(apt-cache policy "$pkg" 2>/dev/null | awk '/Candidate:/ {print $2}')"
  if [[ -z "$candidate" || "$candidate" == "(none)" ]]; then
    die "${pkg} is not available from your apt sources. Run 'sudo apt-get update', or add the PostgreSQL (PGDG) apt repository for version ${major}."
  fi

  # Dry run: refuse if apt would install a PostgreSQL server package (a second cluster).
  sim="$(apt-get install -s -y "$pkg" 2>&1)" || { printf "%s\n" "$sim" >&2; die "apt-get dry run failed (output above)."; }
  extra_servers="$(grep -E '^Inst postgresql-[0-9]+ ' <<<"$sim" | awk '{print $2}' || true)"
  if [[ -n "$extra_servers" ]]; then
    die "Installing ${pkg} would also install: ${extra_servers}. That creates a separate PostgreSQL server. Stopping."
  fi

  if (( CHECK_ONLY )); then
    info "Would install ${pkg} (${candidate})."
  else
    info "Installing ${pkg} (${candidate})…"
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg" >/dev/null
    ok "Installed ${pkg}."
  fi
fi

# --- 4. Enable in the TaskMesh database ------------------------------------
if (( CHECK_ONLY )); then
  info "Would run in ${db_name}: CREATE EXTENSION IF NOT EXISTS vector;"
  info "Check complete. No changes made."
  exit 0
fi

avail="$(as_postgres psql -tAc "SELECT default_version FROM pg_available_extensions WHERE name='vector'" | tr -d '[:space:]')"
[[ -n "$avail" ]] || die "PostgreSQL does not see the vector extension after install. Check that ${pkg} matches the running server."

as_postgres psql -d "$db_name" -v ON_ERROR_STOP=1 -qc "CREATE EXTENSION IF NOT EXISTS vector;"
current="$(as_postgres psql -d "$db_name" -tAc "SELECT extversion FROM pg_extension WHERE extname='vector'" | tr -d '[:space:]')"
[[ -n "$current" ]] || die "CREATE EXTENSION did not take effect."

ok "vector ${current} enabled in ${db_name}."
info "Next: npm run db:migrate  (or npm run deploy:prod)"