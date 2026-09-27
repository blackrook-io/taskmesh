#!/usr/bin/env bash
# Interactive TaskMesh installer for a public Ubuntu server (22.04 / 24.04).
#
# Clone first, as the administrator who will run this script (the account
# with sudo). The taskmesh service user does not exist yet and has no login,
# so that account is not used for the clone. Put the checkout at /srv/taskmesh.
# The installer creates taskmesh and gives that user ownership of the tree.
#
#   sudo apt-get update
#   sudo apt-get install -y git
#   sudo mkdir -p /srv
#   sudo chown "$USER":"$USER" /srv
#   cd /srv
#   git clone https://github.com/blackrook-io/taskmesh.git
#   cd taskmesh
#   bash deploy/install-ubuntu.sh
#
# The app is then served at https://<fqdn>/. Express and PostgreSQL stay on
# loopback. nginx gets one named vhost so other sites can share this host.
# The installer asks for the administrator email and password (or generates
# the password and shows it on this terminal only). Yes/no questions print
# what each answer does, in yellow, before the prompt.
#
#   bash deploy/install-ubuntu.sh --check      # report only; no changes
#   bash deploy/install-ubuntu.sh --self-test  # hostname checks; no sudo
#
# A checkout that is already a development tree at /srv/taskmesh will be
# handed to the taskmesh service user if you continue.
set -euo pipefail
set -E

APP_USER="taskmesh"
APP_ROOT="/srv/taskmesh"
APP_HOME="/var/lib/taskmesh"
UPLOAD_DIR="${APP_HOME}/uploads"
BACKUP_DIR="${APP_HOME}/backups"
ACME_WEBROOT="/var/www/letsencrypt"
GIT_URL="https://github.com/blackrook-io/taskmesh.git"
NODE_MAJOR_TARGET=22
NODE_MAJOR_MIN=20
SITE_TEMPLATE_NAME="nginx-taskmesh-site.conf"
NGINX_SITE_AVAILABLE="/etc/nginx/sites-available/taskmesh"
NGINX_SITE_ENABLED="/etc/nginx/sites-enabled/taskmesh"

CHECK_ONLY=0
FQDN=""
LE_EMAIL=""
DB_PASS=""
DB_PASS_GENERATED=0
DB_PASS_CHANGED=0
OPENAI_API_KEY=""
ADMIN_EMAIL=""
ADMIN_PASS=""
ADMIN_PASS_GENERATED=0
ADMIN_CRED_FILES=()
SOURCE_ROOT=""
SSH_PORT="22"
HTTP_BOOTSTRAP_WRITTEN=0
CERT_FILE=""
KEY_FILE=""
C_YELLOW=""
C_PROMPT=""
C_RESET=""

APT_INSTALL=(
  apt-get install -y
  -o Dpkg::Options::=--force-confdef
  -o Dpkg::Options::=--force-confold
)

die() {
  echo "Error: $*" >&2
  exit 1
}

on_error() {
  local status=$?
  echo "Error: line ${1} failed with status ${status}: ${2}" >&2
  exit "$status"
}
trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

step() {
  echo ""
  echo "==> $*"
}

setup_colors() {
  if [[ -n "${NO_COLOR:-}" ]]; then
    return 0
  fi
  # Prompts are written to /dev/tty, including when stdout is being logged.
  if [[ -w /dev/tty ]]; then
    C_YELLOW=$'\033[33m'
    C_PROMPT=$'\033[1;32m'
    C_RESET=$'\033[0m'
  fi
}

show_on_tty() {
  printf '%s\n' "$1" >/dev/tty
}

note() {
  printf '%s\n' "${C_PROMPT}${1}${C_RESET}" >/dev/tty
}

read_line() {
  local reply
  printf '%s' "${C_PROMPT}${1}${C_RESET}" >/dev/tty
  IFS= read -r reply </dev/tty || die "No terminal is available for prompts."
  printf '%s' "$reply"
}

read_secret() {
  local reply
  printf '%s' "${C_PROMPT}${1}${C_RESET}" >/dev/tty
  IFS= read -r -s reply </dev/tty || die "No terminal is available for prompts."
  printf '\n' >/dev/tty
  printf '%s' "$reply"
}

# $1 question  $2 default y|n  $3 result of yes  $4 result of no  $5 recommendation
ask() {
  local prompt="$1"
  local default="$2"
  local yes_result="$3"
  local no_result="$4"
  local recommendation="$5"
  local hint reply
  if [[ "$default" == "y" ]]; then
    hint="[Y/n]"
  else
    hint="[y/N]"
  fi
  printf '%s\n' "${C_YELLOW}Yes: ${yes_result}${C_RESET}" >/dev/tty
  printf '%s\n' "${C_YELLOW}No: ${no_result}${C_RESET}" >/dev/tty
  printf '%s\n' "${C_YELLOW}Recommendation: ${recommendation}${C_RESET}" >/dev/tty
  while true; do
    printf '%s' "${C_PROMPT}${prompt} ${hint} ${C_RESET}" >/dev/tty
    IFS= read -r reply </dev/tty || die "No terminal is available for prompts."
    if [[ -z "$reply" ]]; then
      reply="$default"
    fi
    case "${reply,,}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) printf '%s\n' "${C_PROMPT}Answer yes or no.${C_RESET}" >/dev/tty ;;
    esac
  done
}

is_fqdn() {
  local value="${1,,}"
  [[ "$value" != *"://"* ]] || return 1
  [[ "$value" != *"/"* ]] || return 1
  [[ "$value" != *":"* ]] || return 1
  [[ "$value" != *" "* ]] || return 1
  [[ "$value" == *"."* ]] || return 1
  [[ "$value" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]
}

is_email() {
  [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]
}

is_db_password() {
  local value="$1"
  [[ "${#value}" -ge 16 ]] || return 1
  [[ "$value" =~ ^[A-Za-z0-9._~-]+$ ]]
}

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

as_taskmesh() {
  sudo -u "$APP_USER" -H -- "$@"
}

as_postgres() {
  if [[ "$(id -u)" -eq 0 ]]; then
    runuser -u postgres -- "$@"
  else
    sudo -u postgres -- "$@"
  fi
}

pkg_installed() {
  local status
  status="$(dpkg-query -W -f='${Status}' "$1" 2>/dev/null || true)"
  [[ "$status" == "install ok installed" ]]
}

apt_installed_version() {
  dpkg-query -W -f='${Version}' "$1" 2>/dev/null || true
}

apt_candidate_version() {
  # Read the whole policy. Exiting awk early closes the pipe and apt-cache
  # dies with SIGPIPE, which aborts the installer under pipefail.
  apt-cache policy "$1" | awk '/Candidate:/ && !found { print $2; found=1 }'
}

node_major() {
  local ver
  ver="$(node -v 2>/dev/null || true)"
  ver="${ver#v}"
  ver="${ver%%.*}"
  if [[ "$ver" =~ ^[0-9]+$ ]]; then
    printf '%s' "$ver"
  else
    printf '0'
  fi
}

require_tty() {
  if [[ ! -r /dev/tty ]]; then
    die "This installer is interactive. Run it in a terminal."
  fi
}

require_admin() {
  local me
  me="$(id -un)"
  if [[ "$me" == "$APP_USER" ]]; then
    die "Run this script as an administrator with sudo, not as the ${APP_USER} service user."
  fi
  if [[ "${SUDO_USER:-}" == "$APP_USER" ]]; then
    die "Run this script as an administrator with sudo, not as the ${APP_USER} service user."
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    sudo -n true 2>/dev/null || die "--check needs sudo. Re-run from a terminal where sudo can start, or use passwordless sudo."
    return 0
  fi
  sudo -v || die "This script needs sudo. Re-run as an administrator."
}

require_ubuntu() {
  local version_id id
  if [[ ! -r /etc/os-release ]]; then
    die "This installer supports Ubuntu 22.04 and 24.04."
  fi
  # shellcheck disable=SC1091
  version_id="$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
  # shellcheck disable=SC1091
  id="$(. /etc/os-release && printf '%s' "${ID:-}")"
  if [[ "$id" != "ubuntu" ]]; then
    die "This installer supports Ubuntu (this system is ${id:-unknown})."
  fi
  echo "Ubuntu ${version_id}."
  case "$version_id" in
    22.04|24.04) ;;
    *)
      if [[ "$CHECK_ONLY" -eq 1 ]]; then
        echo "This script is written for Ubuntu 22.04 and 24.04."
      elif ! ask "This script is written for Ubuntu 22.04 and 24.04 (found ${version_id}). Continue?" n \
        "The installer keeps going on this Ubuntu release. Package names or service behavior may differ from 22.04 and 24.04." \
        "The installer stops. Nothing else is changed." \
        "No. Stop unless you have already confirmed this release matches those package workflows."; then
        die "Aborted."
      fi
      ;;
  esac
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|aarch64|arm64) ;;
    *) die "Unsupported architecture ${arch}. NodeSource packages are used for x86_64 and arm64." ;;
  esac
}

detect_source_root() {
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [[ -f "${root}/package.json" ]] && grep -q '"name": "taskmesh"' "${root}/package.json"; then
    SOURCE_ROOT="$root"
  else
    SOURCE_ROOT=""
  fi
}

detect_ssh_port() {
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    SSH_PORT="${SSH_CONNECTION##* }"
  else
    SSH_PORT="22"
  fi
}

ensure_packages() {
  local pkg inst cand
  local -a install_now=()
  for pkg in "$@"; do
    if ! pkg_installed "$pkg"; then
      if [[ "$CHECK_ONLY" -eq 1 ]]; then
        echo "MISSING   ${pkg}"
      else
        echo "Not installed: ${pkg} — will install."
      fi
      install_now+=("$pkg")
      continue
    fi
    inst="$(apt_installed_version "$pkg")"
    cand="$(apt_candidate_version "$pkg")"
    if [[ -n "$cand" && "$cand" != "(none)" && "$cand" != "$inst" ]]; then
      if [[ "$CHECK_ONLY" -eq 1 ]]; then
        echo "UPGRADE   ${pkg} ${inst} -> ${cand}"
      elif ask "Upgrade ${pkg} from ${inst} to ${cand}?" n \
        "${pkg} is upgraded to ${cand} before the installer continues." \
        "${pkg} stays at ${inst}." \
        "No. Keep the installed version unless you specifically want this upgrade."; then
        install_now+=("$pkg")
      else
          echo "Keeping ${pkg} ${inst}."
      fi
    elif [[ "$CHECK_ONLY" -eq 1 ]]; then
      echo "OK        ${pkg} ${inst}"
    else
      echo "Already installed: ${pkg} ${inst}."
    fi
  done
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    return 0
  fi
  if ((${#install_now[@]} > 0)); then
    run_root "${APT_INSTALL[@]}" "${install_now[@]}"
  fi
}

run_check() {
  step "Packages (upgrade info uses the current apt cache)"
  ensure_packages \
    ca-certificates curl git build-essential openssl \
    postgresql postgresql-contrib \
    nginx ufw certbot
  echo ""
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node_major)"
    if ((major >= NODE_MAJOR_TARGET)); then
      echo "OK        node $(node -v) (target ${NODE_MAJOR_TARGET}.x)"
    elif ((major >= NODE_MAJOR_MIN)); then
      echo "UPGRADE   node $(node -v) — ${NODE_MAJOR_TARGET}.x is recommended"
    else
      echo "UPGRADE   node $(node -v) — TaskMesh needs Node.js ${NODE_MAJOR_MIN}+"
    fi
  else
    echo "MISSING   node (will install ${NODE_MAJOR_TARGET}.x)"
  fi
  echo ""
  if id "$APP_USER" >/dev/null 2>&1; then
    echo "OK        user ${APP_USER} ($(getent passwd "$APP_USER" | cut -d: -f6,7))"
    if user_in_privileged_group "$APP_USER"; then
      echo "WARN      user ${APP_USER} is in a privileged group"
    fi
  else
    echo "MISSING   user ${APP_USER}"
  fi
  if [[ -d "$APP_ROOT" ]]; then
    echo "OK        ${APP_ROOT} (owner $(stat -c '%U:%G' "$APP_ROOT"))"
  else
    echo "MISSING   ${APP_ROOT}"
  fi
  echo ""
  if pkg_installed ufw; then
    run_root ufw status || true
    echo "Firewall changes are host-wide (OpenSSH, TCP 80, TCP 443) and are not applied by --check."
  fi
  if pkg_installed nginx; then
    echo ""
    echo "nginx sites enabled:"
    if [[ -d /etc/nginx/sites-enabled ]]; then
      run_root ls -1 /etc/nginx/sites-enabled || true
    fi
  fi
  echo ""
  echo "Install asks for the public FQDN. The URL will be https://<fqdn>/."
  echo "--check did not change this system."
}

prompt_fqdn() {
  local value
  while true; do
    value="$(read_line "TaskMesh FQDN (example: tasks.example.com): ")"
    if [[ "$value" == *"://"* || "$value" == *"/"* || "$value" == *":"* ]]; then
      note "Enter the FQDN only. HTTPS is used automatically. Example: tasks.example.com"
      continue
    fi
    value="${value,,}"
    if ! is_fqdn "$value"; then
      note "That is not an FQDN. Example: tasks.example.com"
      continue
    fi
    FQDN="$value"
    return 0
  done
}

prompt_email() {
  local value
  while true; do
    value="$(read_line "Let's Encrypt contact email: ")"
    if is_email "$value"; then
      LE_EMAIL="$value"
      return 0
    fi
    note "Enter an email address Let's Encrypt can use for expiry notices."
  done
}

prompt_openai() {
  local value
  value="$(read_secret "OpenAI API key (optional, Enter to skip): ")"
  OPENAI_API_KEY="$value"
}

collect_inputs() {
  step "Site address"
  echo "HTTPS is used for this name. Other websites on this nginx are left alone."
  prompt_fqdn
  prompt_email
  prompt_openai
  echo ""
  echo "URL:          https://${FQDN}/"
  echo "App user:     ${APP_USER}"
  echo "App directory:${APP_ROOT}"
  echo "TLS email:    ${LE_EMAIL}"
  if [[ -n "$OPENAI_API_KEY" ]]; then
    echo "Assistant:    OpenAI key will be written to .env"
  else
    echo "Assistant:    not configured"
  fi
  echo "Firewall:     OpenSSH, TCP 80, and TCP 443 for every site on this host"
  echo "Not opened:   TCP 3000 (Express) and TCP 5432 (PostgreSQL)"
  if ! ask "Continue the installation?" y \
    "Packages, the database, the taskmesh user, nginx, TLS, and the firewall are configured for https://${FQDN}/." \
    "The installer stops. Nothing has been changed yet." \
    "Yes, if the summary above is the site you want."; then
    die "Aborted."
  fi
}

apt_update() {
  step "Package index"
  run_root apt-get update
}

install_base_packages() {
  step "Base packages"
  ensure_packages ca-certificates curl git build-essential openssl
}

install_postgres_packages() {
  step "PostgreSQL"
  ensure_packages postgresql postgresql-contrib
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    return 0
  fi
  run_root systemctl enable --now postgresql
  local attempt=0
  while ((attempt < 30)); do
    attempt=$((attempt + 1))
    if as_postgres pg_isready -q; then
      return 0
    fi
    sleep 1
  done
  die "PostgreSQL did not become ready."
}

install_nodesource() {
  local setup
  setup="$(mktemp)"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "$setup"
  run_root bash "$setup"
  rm -f "$setup"
  run_root "${APT_INSTALL[@]}" nodejs
  hash -r
}

install_node() {
  step "Node.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed. Installing ${NODE_MAJOR_TARGET}.x."
    if [[ "$CHECK_ONLY" -eq 1 ]]; then
      return 0
    fi
    install_nodesource
  else
    local major
    major="$(node_major)"
    if ((major >= NODE_MAJOR_TARGET)); then
      echo "Node.js $(node -v) is already installed."
      if pkg_installed nodejs; then
        ensure_packages nodejs
      fi
    elif ((major >= NODE_MAJOR_MIN)); then
      echo "Node.js $(node -v) meets the minimum (20). TaskMesh installs ${NODE_MAJOR_TARGET}.x on new servers."
      if [[ "$CHECK_ONLY" -eq 1 ]]; then
        return 0
      fi
      if ask "Upgrade Node.js to ${NODE_MAJOR_TARGET}.x from NodeSource?" y \
        "Node.js is replaced with the NodeSource ${NODE_MAJOR_TARGET}.x packages. Later npm builds use that version." \
        "The installer keeps Node.js $(node -v). The app can run, but new servers use ${NODE_MAJOR_TARGET}.x." \
        "Yes. Install Node.js ${NODE_MAJOR_TARGET}.x so this host matches a new TaskMesh server."; then
        install_nodesource
      else
        echo "Keeping Node.js $(node -v)."
      fi
    else
      echo "Node.js $(node -v) is older than ${NODE_MAJOR_MIN}, which TaskMesh requires."
      if [[ "$CHECK_ONLY" -eq 1 ]]; then
        return 0
      fi
      if ask "Upgrade Node.js to ${NODE_MAJOR_TARGET}.x from NodeSource?" y \
        "Node.js is replaced with the NodeSource ${NODE_MAJOR_TARGET}.x packages, which this app requires." \
        "The installer stops. Node.js $(node -v) is too old to build or run TaskMesh." \
        "Yes. The install cannot finish on this Node.js version."; then
        install_nodesource
      else
        die "Cannot continue without Node.js ${NODE_MAJOR_MIN} or newer."
      fi
    fi
  fi
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    return 0
  fi
  hash -r
  local major
  major="$(node_major)"
  if ((major < NODE_MAJOR_MIN)); then
    die "Node.js $(node -v) is still older than ${NODE_MAJOR_MIN}."
  fi
  echo "Using Node.js $(node -v) and npm $(npm -v)."
}

install_web_packages() {
  step "nginx, firewall, and certificates"
  ensure_packages nginx ufw certbot
}

user_in_privileged_group() {
  local groups
  groups=" $(id -nG "$1") "
  [[ "$groups" == *" sudo "* || "$groups" == *" adm "* || "$groups" == *" wheel "* ]]
}

drop_privileged_groups() {
  local group
  local groups
  groups="$(id -nG "$APP_USER")"
  for group in sudo adm wheel; do
    if grep -Eq "(^| )${group}( |$)" <<<"$groups"; then
      echo "User ${APP_USER} is in the ${group} group."
      if ask "Remove ${APP_USER} from the ${group} group?" y \
        "${APP_USER} loses ${group} access and stays a service account without sudo." \
        "The installer stops. The service account would still be in ${group}." \
        "Yes. The account that runs TaskMesh must not have ${group} access."; then
        run_root gpasswd -d "$APP_USER" "$group"
      else
        die "The ${APP_USER} service user must not keep ${group} access."
      fi
    fi
  done
}

ensure_service_user() {
  step "Service user ${APP_USER}"
  if id "$APP_USER" >/dev/null 2>&1; then
    local shell
    shell="$(getent passwd "$APP_USER" | cut -d: -f7)"
    echo "User ${APP_USER} already exists (shell ${shell})."
    if [[ "$shell" != "/usr/sbin/nologin" && "$shell" != "/bin/false" ]]; then
      if ! ask "This account can log in. Use it as the unprivileged service account anyway?" n \
        "The existing ${APP_USER} login account becomes the account that runs the app. It will not be given sudo." \
        "The installer stops. Create a separate nologin system user named ${APP_USER} before running it again." \
        "No. Stop and use a dedicated nologin account rather than a user that can sign in."; then
        die "Aborted."
      fi
    fi
    drop_privileged_groups
  else
    run_root useradd \
      --system \
      --create-home \
      --home-dir "$APP_HOME" \
      --shell /usr/sbin/nologin \
      --user-group \
      "$APP_USER"
    echo "Created system user ${APP_USER}."
  fi
  run_root mkdir -p "$UPLOAD_DIR" "$BACKUP_DIR"
  run_root chown -R "${APP_USER}:${APP_USER}" "$APP_HOME"
  run_root chmod 750 "$APP_HOME" "$UPLOAD_DIR"
  run_root chmod 700 "$BACKUP_DIR"
  if user_in_privileged_group "$APP_USER"; then
    die "User ${APP_USER} still belongs to a privileged group."
  fi
}

sql_escape() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf '%s' "$value"
}

prompt_new_db_password() {
  local first second
  while true; do
    first="$(read_secret "Postgres password for ${APP_USER} (Enter to generate one): ")"
    if [[ -z "$first" ]]; then
      DB_PASS="$(openssl rand -hex 24)"
      DB_PASS_GENERATED=1
      show_on_tty "Database password (shown only on this terminal, not in the install log):"
      show_on_tty "$DB_PASS"
      show_on_tty "It is also stored in ${APP_ROOT}/.env as DATABASE_URL."
      return 0
    fi
    if ! is_db_password "$first"; then
      note "Use at least 16 characters from letters, digits, and . _ ~ - so the password is safe in DATABASE_URL."
      continue
    fi
    second="$(read_secret "Repeat the password: ")"
    if [[ "$first" != "$second" ]]; then
      note "The passwords did not match."
      continue
    fi
    DB_PASS="$first"
    DB_PASS_GENERATED=0
    return 0
  done
}

prompt_existing_db_password() {
  local value
  while true; do
    value="$(read_secret "Current Postgres password for ${APP_USER}: ")"
    if is_db_password "$value"; then
      DB_PASS="$value"
      DB_PASS_GENERATED=0
      return 0
    fi
    note "That password cannot be stored in DATABASE_URL. Use letters, digits, and . _ ~ - (at least 16)."
  done
}

load_db_password_from_env() {
  local line pass
  root_file_exists "${APP_ROOT}/.env" || return 1
  line="$(run_root grep -E '^DATABASE_URL=' "${APP_ROOT}/.env" || true)"
  line="${line#DATABASE_URL=}"
  line="${line#\"}"
  line="${line%\"}"
  line="${line#\'}"
  line="${line%\'}"
  [[ "$line" == postgresql://${APP_USER}:*@* ]] || return 1
  pass="${line#postgresql://"${APP_USER}":}"
  pass="${pass%%@*}"
  is_db_password "$pass" || return 1
  DB_PASS="$pass"
  DB_PASS_GENERATED=0
}

postgres_role_exists() {
  local found
  found="$(as_postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${APP_USER}'")"
  [[ "$found" == "1" ]]
}

postgres_db_exists() {
  local found
  found="$(as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${APP_USER}'")"
  [[ "$found" == "1" ]]
}

apply_db_password() {
  local escaped
  escaped="$(sql_escape "$DB_PASS")"
  as_postgres psql -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE ${APP_USER} WITH LOGIN PASSWORD '${escaped}';
SQL
}

ensure_database() {
  step "TaskMesh database"
  local role_exists db_exists
  role_exists=0
  db_exists=0
  if postgres_role_exists; then
    role_exists=1
    echo "Postgres role ${APP_USER} already exists."
  else
    echo "Postgres role ${APP_USER} is not on this server."
  fi
  if postgres_db_exists; then
    db_exists=1
    echo "Database ${APP_USER} already exists. Its data will be left in place."
  else
    echo "Database ${APP_USER} is not on this server."
  fi

  if [[ "$role_exists" -eq 1 ]]; then
    if ask "Replace the password for the ${APP_USER} database role?" n \
      "The role password is changed. The installer stores the new password in .env. Existing data in the database stays." \
      "The role password stays as it is, and the database is not recreated. If .env already has that password, the installer continues without asking for it. If .env is missing, you type the current password so the new file can connect." \
      "No. Keep the current password when this database was already installed."; then
      prompt_new_db_password
      apply_db_password
      DB_PASS_CHANGED=1
    else
      DB_PASS_CHANGED=0
      if load_db_password_from_env; then
        echo "Keeping the current database password from ${APP_ROOT}/.env."
      else
        echo "The database password will not be changed."
        echo "${APP_ROOT}/.env does not already contain it. The current password is needed so the new environment file can connect."
        prompt_existing_db_password
      fi
    fi
  else
    prompt_new_db_password
    local escaped
    escaped="$(sql_escape "$DB_PASS")"
    as_postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE ${APP_USER} LOGIN PASSWORD '${escaped}';
SQL
    DB_PASS_CHANGED=1
    echo "Created Postgres role ${APP_USER}."
  fi

  if [[ "$db_exists" -eq 1 ]]; then
    as_postgres psql -v ON_ERROR_STOP=1 -c "ALTER DATABASE ${APP_USER} OWNER TO ${APP_USER};"
    echo "Left database ${APP_USER} in place."
  else
    as_postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${APP_USER} OWNER ${APP_USER};"
    echo "Created database ${APP_USER}."
  fi

  as_postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE ${APP_USER} TO ${APP_USER};"
  as_postgres psql -d "$APP_USER" -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO ${APP_USER};"
  as_postgres psql -d "$APP_USER" -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${APP_USER};"

  if ! smoke_test_database; then
    echo "Password login to ${APP_USER} on 127.0.0.1 failed."
    if ! ask "Allow password login from this server to the ${APP_USER} database?" y \
      "pg_hba.conf gains scram-sha-256 lines for ${APP_USER} on 127.0.0.1 and ::1, then PostgreSQL is reloaded. The app can connect." \
      "The installer stops. Migrations cannot log in with the database password." \
      "Yes. Local password login is required for TaskMesh."; then
      die "Cannot continue without a working database login."
    fi
    local hba
    hba="$(as_postgres psql -tAc 'SHOW hba_file;')"
    hba="$(echo "$hba" | tr -d '[:space:]')"
    if ! run_root grep -Eq "^[[:space:]]*host[[:space:]]+${APP_USER}[[:space:]]+${APP_USER}[[:space:]]+127\\.0\\.0\\.1/32[[:space:]]+" "$hba"; then
      printf '\n# Added by deploy/install-ubuntu.sh\nhost %s %s 127.0.0.1/32 scram-sha-256\nhost %s %s ::1/128 scram-sha-256\n' \
        "$APP_USER" "$APP_USER" "$APP_USER" "$APP_USER" | run_root tee -a "$hba" >/dev/null
      run_root systemctl reload postgresql
    fi
    smoke_test_database || die "Still cannot log in to the ${APP_USER} database on 127.0.0.1."
  fi
  echo "Database login works."
}

smoke_test_database() {
  local pgpass
  pgpass="$(mktemp)"
  chmod 600 "$pgpass"
  printf '%s\n' "127.0.0.1:5432:${APP_USER}:${APP_USER}:${DB_PASS}" >"$pgpass"
  if PGPASSFILE="$pgpass" PGCONNECT_TIMEOUT=5 psql -h 127.0.0.1 -U "$APP_USER" -d "$APP_USER" -c "SELECT current_user, current_database();" >/dev/null; then
    rm -f "$pgpass"
    return 0
  fi
  rm -f "$pgpass"
  return 1
}

clone_app_tree() {
  run_root mkdir -p "$APP_ROOT"
  if [[ -n "$SOURCE_ROOT" && "$SOURCE_ROOT" != "$APP_ROOT" ]]; then
    local origin
    origin="$(git -C "$SOURCE_ROOT" remote get-url origin 2>/dev/null || true)"
    if [[ -z "$origin" ]]; then
      origin="$GIT_URL"
    fi
    if [[ -n "$(git -C "$SOURCE_ROOT" status --porcelain 2>/dev/null || true)" ]]; then
      echo "The checkout at ${SOURCE_ROOT} has uncommitted files. The clone includes committed files only."
    fi
    # Clone as root so a checkout the service user cannot read still copies,
    # then hand the tree to taskmesh.
    run_root git -c "safe.directory=${SOURCE_ROOT}" clone "$SOURCE_ROOT" "$APP_ROOT"
    run_root chown -R "${APP_USER}:${APP_USER}" "$APP_ROOT"
    as_taskmesh git -C "$APP_ROOT" remote set-url origin "$origin"
  else
    run_root chown "${APP_USER}:${APP_USER}" "$APP_ROOT"
    as_taskmesh git clone "$GIT_URL" "$APP_ROOT"
  fi
}

ensure_app_tree() {
  step "Application files"
  if [[ -d "$APP_ROOT" ]] && [[ -n "$(ls -A "$APP_ROOT" 2>/dev/null || true)" ]]; then
    if [[ ! -f "${APP_ROOT}/package.json" ]] || ! grep -q '"name": "taskmesh"' "${APP_ROOT}/package.json"; then
      die "${APP_ROOT} exists and is not a TaskMesh checkout."
    fi
    local owner
    owner="$(stat -c '%U' "$APP_ROOT")"
    echo "Using existing checkout ${APP_ROOT} (owner ${owner})."
    if [[ "$owner" != "$APP_USER" ]]; then
      if ! ask "Change ownership of ${APP_ROOT} from ${owner} to ${APP_USER}?" y \
        "The application tree, including .git and .env, becomes owned by ${APP_USER}. Your account will need sudo to update git afterward." \
        "The installer stops. The service cannot run a tree it does not own." \
        "Yes. The service account has to own the files it runs."; then
        die "Aborted. The service user must own the application tree."
      fi
    fi
    run_root chown -R "${APP_USER}:${APP_USER}" "$APP_ROOT"
    if [[ -d "${APP_ROOT}/.git" ]]; then
      if ask "Run git pull --ff-only in ${APP_ROOT}?" n \
        "The checkout fast-forwards to its upstream. The install then builds that updated tree. Uncommitted files are left in place and can make the pull fail." \
        "The installer builds the files already in ${APP_ROOT}. Nothing is fetched." \
        "No. Keep this checkout when it is already the version you intend to install."; then
        as_taskmesh git -C "$APP_ROOT" pull --ff-only
      fi
    fi
  else
    echo "Cloning TaskMesh into ${APP_ROOT}."
    clone_app_tree
  fi
  run_root chown -R "${APP_USER}:${APP_USER}" "$APP_ROOT"
  if [[ ! -f "${APP_ROOT}/deploy/${SITE_TEMPLATE_NAME}" ]]; then
    die "Missing ${APP_ROOT}/deploy/${SITE_TEMPLATE_NAME}. The checkout is incomplete."
  fi
}

generate_key() {
  openssl rand -base64 48 | tr -d '\n'
}

write_env_file() {
  local oauth_key mfa_key tmp
  oauth_key="$(generate_key)"
  mfa_key="$(generate_key)"
  if [[ "${#oauth_key}" -lt 32 || "${#mfa_key}" -lt 32 ]]; then
    die "Could not generate encryption keys."
  fi
  tmp="$(mktemp)"
  chmod 600 "$tmp"
  {
    printf 'DATABASE_URL=postgresql://%s:%s@127.0.0.1:5432/%s\n' "$APP_USER" "$DB_PASS" "$APP_USER"
    printf 'HOST=127.0.0.1\n'
    printf 'PORT=3000\n'
    printf 'TRUST_PROXY=1\n'
    printf 'COOKIE_SECURE=true\n'
    printf 'UPLOAD_DIR=%s\n' "$UPLOAD_DIR"
    printf 'BACKUP_DIR=%s\n' "$BACKUP_DIR"
    printf 'OAUTH_PUBLIC_BASE_URL=https://%s\n' "$FQDN"
    printf 'OAUTH_CREDENTIALS_KEY=%s\n' "$oauth_key"
    printf 'MFA_TOTP_KEY=%s\n' "$mfa_key"
    if [[ -n "$OPENAI_API_KEY" ]]; then
      printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY"
      printf 'ASSISTANT_DEFAULT_PROVIDER=openai\n'
      printf 'ASSISTANT_DEFAULT_MODEL=gpt-4.1-mini\n'
    fi
  } >"$tmp"
  run_root install -o "$APP_USER" -g "$APP_USER" -m 600 "$tmp" "${APP_ROOT}/.env"
  rm -f "$tmp"
}

ensure_env() {
  step "Environment file"
  if [[ -f "${APP_ROOT}/.env" ]]; then
    local replace_default
    replace_default="n"
    local env_recommend
    if [[ "$DB_PASS_CHANGED" -eq 1 ]]; then
      echo "The database password was set during this run. .env must match it."
      replace_default="y"
      env_recommend="Yes. The database password changed, so the existing .env would point at the old password."
    else
      env_recommend="No. Keep the existing file so the current database password and keys stay put."
    fi
    if ask "Replace ${APP_ROOT}/.env?" "$replace_default" \
      "The current .env is overwritten. DATABASE_URL uses this run's database password, and new OAuth and MFA keys are generated." \
      "The current .env stays. If the database password was changed in this run, the installer stops because the app could not connect." \
      "$env_recommend"; then
      write_env_file
      echo "Wrote ${APP_ROOT}/.env (mode 600, owner ${APP_USER})."
    else
      if [[ "$DB_PASS_CHANGED" -eq 1 ]]; then
        die "Refusing to continue: DATABASE_URL would not match the new database password."
      fi
      run_root chown "${APP_USER}:${APP_USER}" "${APP_ROOT}/.env"
      run_root chmod 600 "${APP_ROOT}/.env"
      echo "Kept the existing .env and restricted it to ${APP_USER} (mode 600)."
    fi
  else
    write_env_file
    echo "Wrote ${APP_ROOT}/.env (mode 600, owner ${APP_USER})."
  fi
}

write_admin_helper() {
  local dest="$1"
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp" <<'EOF'
import fs from "node:fs";
import pg from "pg";
import "dotenv/config";
import { hashPassword, validatePassword } from "./dist/lib/password.js";

const mode = process.argv[2];

function readCredentials() {
  const text = fs.readFileSync(process.argv[3], "utf8");
  const nl = text.indexOf("\n");
  if (nl < 1) {
    console.error("Credential file is incomplete.");
    process.exit(1);
  }
  return {
    email: text.slice(0, nl).trim().toLowerCase(),
    password: text.slice(nl + 1).replace(/\n$/, ""),
  };
}

if (mode === "check") {
  const problem = validatePassword(readCredentials().password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function finish(code) {
  await client.end();
  process.exit(code);
}

if (mode === "status") {
  const found = await client.query(
    "SELECT email, (password_hash IS NOT NULL) AS has_password FROM users WHERE number = 1",
  );
  if (!found.rowCount) {
    console.error("User number 1 was not found. Database migrations did not seed the administrator.");
    await finish(2);
  }
  const row = found.rows[0];
  process.stdout.write(`${row.has_password ? "yes" : "no"}\t${row.email ?? ""}\n`);
  await finish(0);
}

if (mode !== "apply") {
  console.error("Unknown administrator helper mode.");
  await finish(1);
}
const { email, password } = readCredentials();
if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
  console.error("Enter an email address.");
  await finish(1);
}
const problem = validatePassword(password);
if (problem) {
  console.error(problem);
  await finish(1);
}
const passwordHash = await hashPassword(password);
const saved = await client.query(
  "UPDATE users SET email = $1, password_hash = $2, updated_at = now() WHERE number = 1 RETURNING email, display_name",
  [email, passwordHash],
);
if (saved.rowCount !== 1) {
  console.error("User number 1 was not found.");
  await finish(2);
}
console.log(`Administrator sign-in saved for ${saved.rows[0].email} (${saved.rows[0].display_name}).`);
await finish(0);
EOF
  run_root install -o "$APP_USER" -g "$APP_USER" -m 600 "$tmp" "$dest"
  rm -f "$tmp"
}

admin_node() {
  as_taskmesh bash -lc "cd '${APP_ROOT}' && node '${APP_ROOT}/.install-admin.mjs' $(printf '%q ' "$@")"
}

cleanup_admin_files() {
  local f
  run_root rm -f "${APP_ROOT}/.install-admin.mjs"
  if ((${#ADMIN_CRED_FILES[@]} > 0)); then
    for f in "${ADMIN_CRED_FILES[@]}"; do
      run_root rm -f "$f"
    done
  fi
}

write_login_file() {
  local file="$1"
  local email="$2"
  local password="$3"
  local previous_umask
  previous_umask="$(umask)"
  umask 077
  printf '%s\n%s\n' "$email" "$password" >"$file"
  umask "$previous_umask"
  chmod 600 "$file"
  run_root chown "${APP_USER}:${APP_USER}" "$file"
}

generate_login_password() {
  local hex candidate creds attempt
  attempt=0
  creds="$(mktemp)"
  ADMIN_CRED_FILES+=("$creds")
  chmod 600 "$creds"
  while (( attempt < 40 )); do
    attempt=$((attempt + 1))
    hex="$(od -An -tx1 -N 16 /dev/urandom | tr -d ' \n')"
    candidate="Tm${hex}9!"
    write_login_file "$creds" "check@example.com" "$candidate"
    if admin_node check "$creds" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      run_root rm -f "$creds"
      return 0
    fi
  done
  run_root rm -f "$creds"
  return 1
}

configure_admin_login() {
  step "Administrator sign-in"
  local helper state has existing_email first second creds
  helper="${APP_ROOT}/.install-admin.mjs"
  trap cleanup_admin_files EXIT
  write_admin_helper "$helper"
  state="$(admin_node status | tail -n 1)" || die "Could not read the administrator account."
  has="${state%%$'\t'*}"
  existing_email="${state#*$'\t'}"
  existing_email="${existing_email//$'\n'/}"
  if [[ "$has" == "yes" && -n "$existing_email" ]]; then
    if ! ask "Replace the administrator sign-in for ${existing_email}?" n \
      "You choose a new email and password for the built-in administrator (user number 1). The previous password stops working." \
      "The current email and password stay. Sign in at https://${FQDN}/ with the account that already works." \
      "No. Keep the current sign-in unless you need to replace it."; then
      run_root rm -f "$helper"
      return 0
    fi
  elif [[ "$has" == "yes" ]]; then
    if ! ask "Set an email on the administrator account that already has a password?" y \
      "You set the email and replace the password for user number 1 so you can sign in at https://${FQDN}/." \
      "The installer leaves the account unchanged. It has a password but no email, so the login page cannot use it." \
      "Yes. An email is required to sign in."; then
      run_root rm -f "$helper"
      echo "No administrator email was set. The login page needs an email and password."
      return 0
    fi
  else
    echo "The built-in administrator (user number 1) has no password yet."
    echo "This becomes the sign-in for https://${FQDN}/."
  fi
  while true; do
    if [[ -n "$existing_email" ]]; then
      ADMIN_EMAIL="$(read_line "Administrator email [${existing_email}]: ")"
      if [[ -z "$ADMIN_EMAIL" ]]; then
        ADMIN_EMAIL="$existing_email"
      fi
    else
      ADMIN_EMAIL="$(read_line "Administrator email: ")"
    fi
    ADMIN_EMAIL="${ADMIN_EMAIL,,}"
    if is_email "$ADMIN_EMAIL"; then
      break
    fi
    note "Enter an email address."
  done
  printf '%s\n' "${C_YELLOW}Password rules: at least 12 characters, with an uppercase letter, a lowercase letter, a digit, and a symbol. No triple repeats, sequences such as abcd or 1234, keyboard runs, or common words.${C_RESET}" >/dev/tty
  printf '%s\n' "${C_YELLOW}Press Enter to generate a password. A generated password is shown on this terminal and is not written to the install log.${C_RESET}" >/dev/tty
  while true; do
    first="$(read_secret "Administrator password (Enter to generate one): ")"
    if [[ -z "$first" ]]; then
      first="$(generate_login_password)" || die "Could not generate a password that meets the sign-in rules."
      ADMIN_PASS="$first"
      ADMIN_PASS_GENERATED=1
      show_on_tty "Administrator password (shown only on this terminal, not in the install log):"
      show_on_tty "$ADMIN_PASS"
      break
    fi
    second="$(read_secret "Repeat the password: ")"
    if [[ "$first" != "$second" ]]; then
      note "The passwords did not match."
      continue
    fi
    creds="$(mktemp)"
    ADMIN_CRED_FILES+=("$creds")
    chmod 600 "$creds"
    write_login_file "$creds" "$ADMIN_EMAIL" "$first"
    if admin_node check "$creds"; then
      ADMIN_PASS="$first"
      ADMIN_PASS_GENERATED=0
      run_root rm -f "$creds"
      break
    fi
    run_root rm -f "$creds"
    note "Choose a different password."
  done
  creds="$(mktemp)"
  ADMIN_CRED_FILES+=("$creds")
  chmod 600 "$creds"
  write_login_file "$creds" "$ADMIN_EMAIL" "$ADMIN_PASS"
  echo "Saving the administrator sign-in..."
  admin_node apply "$creds"
  run_root rm -f "$creds" "$helper"
}

npm_install_and_build() {
  step "Dependencies, migrations, and production build"
  as_taskmesh bash -lc "cd '${APP_ROOT}' && npm install"
  as_taskmesh bash -lc "cd '${APP_ROOT}' && npm install --prefix client"
  if [[ ! -d "${APP_ROOT}/client/public/excalidraw-assets/fonts" ]]; then
    die "Excalidraw fonts were not copied. Re-run npm install in client/."
  fi
  as_taskmesh bash -lc "cd '${APP_ROOT}' && npm run db:migrate"
  as_taskmesh bash -lc "cd '${APP_ROOT}' && npm run build:all"
  if [[ ! -f "${APP_ROOT}/dist/index.js" || ! -f "${APP_ROOT}/client/dist/index.html" ]]; then
    die "The production build did not produce dist/index.js and client/dist/index.html."
  fi
  configure_admin_login
}

install_systemd_unit() {
  local src dest tmp node_bin npm_bin
  src="$1"
  dest="$2"
  node_bin="$(command -v node)"
  npm_bin="$(command -v npm)"
  tmp="$(mktemp)"
  sed "s/YOUR_USER/${APP_USER}/g" "$src" >"$tmp"
  if [[ "$node_bin" != "/usr/bin/node" ]]; then
    sed -i "s|/usr/bin/node|${node_bin}|g" "$tmp"
  fi
  if [[ "$npm_bin" != "/usr/bin/npm" ]]; then
    sed -i "s|/usr/bin/npm|${npm_bin}|g" "$tmp"
  fi
  if [[ -f "$dest" ]] && ! cmp -s "$tmp" "$dest"; then
    if ! ask "Replace ${dest}?" y \
      "The systemd unit is replaced with the copy from this checkout, running as ${APP_USER}." \
      "The existing unit file stays. The installer stops when this is the app service, or skips the backup timer when this is the backup unit." \
      "Yes. Install the unit shipped with this version of TaskMesh."; then
      rm -f "$tmp"
      return 1
    fi
  fi
  run_root install -m 644 "$tmp" "$dest"
  rm -f "$tmp"
}

install_systemd() {
  step "systemd service"
  install_systemd_unit "${APP_ROOT}/deploy/taskmesh.service" /etc/systemd/system/taskmesh.service \
    || die "Aborted. /etc/systemd/system/taskmesh.service was left unchanged."
  run_root systemctl daemon-reload
  run_root systemctl enable --now taskmesh
  run_root systemctl restart taskmesh
  local attempt=0
  while ((attempt < 60)); do
    attempt=$((attempt + 1))
    if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      echo "taskmesh.service is healthy on 127.0.0.1:3000."
      return 0
    fi
    sleep 0.5
  done
  run_root systemctl status taskmesh --no-pager || true
  die "taskmesh.service did not become healthy on 127.0.0.1:3000."
}

nginx_includes_sites() {
  run_root grep -q 'sites-enabled' /etc/nginx/nginx.conf
}

reject_port_conflict() {
  local port="$1"
  local listeners
  listeners="$(run_root ss -tlnp "sport = :${port}" 2>/dev/null || true)"
  if [[ -z "$listeners" ]]; then
    return 0
  fi
  if grep -q nginx <<<"$listeners"; then
    return 0
  fi
  # ss without process names still shows listeners. If the line has no nginx
  # and the port is taken, another program owns it.
  if grep -q ":${port}" <<<"$listeners"; then
    if grep -qi 'nginx' <<<"$listeners"; then
      return 0
    fi
    if grep -Eq 'users:\(\(' <<<"$listeners"; then
      die "Port ${port} is in use by a process other than nginx. Stop that service before installing the TaskMesh site."
    fi
  fi
}

write_http_bootstrap() {
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp" <<EOF
# Temporary HTTP vhost so Let's Encrypt can validate ${FQDN}.
# deploy/install-ubuntu.sh replaces this file after the certificate is issued.
server {
  listen 80;
  listen [::]:80;
  server_name ${FQDN};

  location ^~ /.well-known/acme-challenge/ {
    root ${ACME_WEBROOT};
  }

  location / {
    return 301 https://\$host\$request_uri;
  }
}
EOF
  if [[ -f "$NGINX_SITE_AVAILABLE" ]] && ! grep -q "Temporary HTTP vhost so Let's Encrypt" "$NGINX_SITE_AVAILABLE"; then
    if ! ask "Replace ${NGINX_SITE_AVAILABLE} with an HTTP site for ${FQDN}?" y \
      "That one site file becomes a temporary HTTP server for ${FQDN} so Let's Encrypt can validate the name. Other sites in sites-enabled stay." \
      "The installer stops. The existing site file is left unchanged." \
      "Yes, if this file is the TaskMesh site. No, if it is a site you still need as it is."; then
      rm -f "$tmp"
      die "Aborted."
    fi
  fi
  run_root install -m 644 "$tmp" "$NGINX_SITE_AVAILABLE"
  rm -f "$tmp"
  HTTP_BOOTSTRAP_WRITTEN=1
}

render_https_site() {
  local tmp
  if [[ -z "$CERT_FILE" || -z "$KEY_FILE" ]]; then
    CERT_FILE="/etc/letsencrypt/live/${FQDN}/fullchain.pem"
    KEY_FILE="/etc/letsencrypt/live/${FQDN}/privkey.pem"
  fi
  tmp="$(mktemp)"
  sed \
    -e "s|__TASKMESH_FQDN__|${FQDN}|g" \
    -e "s|__TASKMESH_SSL_CERTIFICATE__|${CERT_FILE}|g" \
    -e "s|__TASKMESH_SSL_CERTIFICATE_KEY__|${KEY_FILE}|g" \
    "${APP_ROOT}/deploy/${SITE_TEMPLATE_NAME}" >"$tmp"
  if grep -q '__TASKMESH_' "$tmp"; then
    rm -f "$tmp"
    die "The nginx site template still contains unsubstituted tokens."
  fi
  if [[ "$HTTP_BOOTSTRAP_WRITTEN" -eq 0 && -f "$NGINX_SITE_AVAILABLE" ]] && ! cmp -s "$tmp" "$NGINX_SITE_AVAILABLE"; then
    if ! ask "Replace the nginx site ${NGINX_SITE_AVAILABLE}?" y \
      "That site file becomes the HTTPS vhost for ${FQDN} only. It is not the default site. Other sites in sites-enabled stay." \
      "The installer stops. The current TaskMesh nginx file stays as it is." \
      "Yes. Publish https://${FQDN}/ from this vhost."; then
      rm -f "$tmp"
      die "Aborted."
    fi
  fi
  run_root install -m 644 "$tmp" "$NGINX_SITE_AVAILABLE"
  rm -f "$tmp"
}

reload_nginx() {
  run_root nginx -t
  run_root systemctl enable nginx
  if run_root systemctl is-active --quiet nginx; then
    run_root systemctl reload nginx
  else
    run_root systemctl restart nginx
  fi
}

enable_site_link() {
  run_root ln -sfn "$NGINX_SITE_AVAILABLE" "$NGINX_SITE_ENABLED"
}

warn_server_name_clash() {
  local file name
  for file in /etc/nginx/sites-enabled/*; do
    [[ -f "$file" ]] || continue
    if [[ "$file" == "$NGINX_SITE_ENABLED" ]]; then
      continue
    fi
    while read -r name; do
      name="${name%;}"
      if [[ "$name" == "$FQDN" ]]; then
        echo "Another nginx site already uses server_name ${FQDN}: ${file}"
        if ! ask "Continue with two nginx sites both named ${FQDN}?" n \
          "The installer continues. Nginx will use one of the two server blocks for ${FQDN}, which can send traffic to the wrong site." \
          "The installer stops so you can change or remove the other server_name before trying again." \
          "No. Fix the other site file so only one server answers for ${FQDN}."; then
          die "Aborted."
        fi
      fi
    done < <(awk '$1 == "server_name" { for (i = 2; i <= NF; i++) print $i }' "$file")
  done
}

install_nginx_http() {
  step "nginx site for ${FQDN}"
  if run_root systemctl is-active --quiet apache2; then
    die "apache2 is running. This installer adds a site to nginx and will not stop apache. Move the other websites to nginx, or stop apache, then re-run."
  fi
  if ! nginx_includes_sites; then
    die "/etc/nginx/nginx.conf does not include sites-enabled. Add 'include /etc/nginx/sites-enabled/*;' inside the http block, then re-run."
  fi
  reject_port_conflict 80
  reject_port_conflict 443
  warn_server_name_clash
  run_root mkdir -p "$ACME_WEBROOT"
  run_root chmod 755 /var/www "$ACME_WEBROOT"
  echo "Leaving every other file in sites-enabled in place. This site is not default_server."
  if find_certificate_paths; then
    echo "A valid Let's Encrypt certificate for ${FQDN} is already on this system."
    echo "The temporary HTTP site is not written. nginx will use ${CERT_FILE}."
    render_https_site
  else
    write_http_bootstrap
  fi
  enable_site_link
  reload_nginx
}

ufw_status_text() {
  run_root ufw status 2>/dev/null || true
}

ufw_allows_port() {
  local port="$1"
  local status
  status="$(ufw_status_text)"
  if [[ "$port" == "80" ]] && grep -Eq '^Nginx (HTTP|Full)([[:space:]]|$)' <<<"$status"; then
    return 0
  fi
  if [[ "$port" == "443" ]] && grep -Eq '^Nginx (HTTPS|Full)([[:space:]]|$)' <<<"$status"; then
    return 0
  fi
  grep -Eq "^${port}/tcp[[:space:]]" <<<"$status"
}

ufw_allows_ssh() {
  local status
  status="$(ufw_status_text)"
  if [[ "$SSH_PORT" == "22" ]]; then
    grep -Eq '^(OpenSSH|22/tcp)[[:space:]]' <<<"$status"
    return
  fi
  grep -Eq "^${SSH_PORT}/tcp[[:space:]]" <<<"$status"
}

ufw_allow_ssh() {
  if [[ "$SSH_PORT" == "22" ]]; then
    if ! run_root ufw allow OpenSSH; then
      run_root ufw allow 22/tcp comment 'SSH'
    fi
  else
    run_root ufw allow "${SSH_PORT}/tcp" comment 'SSH'
  fi
}

configure_firewall() {
  step "Firewall (shared by every website on this host)"
  echo "Ports 80 and 443 serve all nginx sites, including TaskMesh."
  echo "SSH is allowed on port ${SSH_PORT}. Ports 3000 and 5432 stay closed."
  local status
  status="$(ufw_status_text)"
  if grep -q 'Status: inactive' <<<"$status"; then
    echo "UFW is installed and inactive. Enabling it would set:"
    echo "  allow SSH on port ${SSH_PORT}"
    echo "  allow 80/tcp"
    echo "  allow 443/tcp"
    echo "  default deny incoming"
    echo "  default allow outgoing"
    echo "Existing application rules are not deleted because the firewall is off."
    if ! ask "Enable UFW with OpenSSH plus TCP 80 and 443?" y \
      "UFW is enabled with incoming denied by default, and OpenSSH, port 80, and port 443 allowed. Ports 3000 and 5432 stay closed. Existing allow rules stay." \
      "UFW stays off. The site is reachable only if another firewall already allows ports 80 and 443. Let's Encrypt cannot issue a certificate if port 80 is blocked." \
      "Yes. Enable the firewall and open the web ports."; then
      echo "UFW was not enabled. The site is reachable only if another firewall already allows TCP 80 and 443."
      return 0
    fi
    ufw_allow_ssh
    run_root ufw allow 80/tcp comment 'HTTP for nginx sites'
    run_root ufw allow 443/tcp comment 'HTTPS for nginx sites'
    run_root ufw default deny incoming
    run_root ufw default allow outgoing
    run_root ufw --force enable
    run_root ufw status verbose
    return 0
  fi

  echo "UFW is already active. Existing allow rules are left in place."
  local -a missing=()
  if ! ufw_allows_ssh; then
    missing+=("SSH port ${SSH_PORT}")
  fi
  if ! ufw_allows_port 80; then
    missing+=("80/tcp")
  fi
  if ! ufw_allows_port 443; then
    missing+=("443/tcp")
  fi
  if ((${#missing[@]} == 0)); then
    echo "SSH, TCP 80, and TCP 443 are already allowed."
    run_root ufw status
    return 0
  fi
  echo "Missing allow rules: ${missing[*]}"
  if ! ask "Add only those missing UFW rules?" y \
    "UFW gains the missing allows from this list: ${missing[*]}. The default policy and every existing allow rule stay." \
    "The firewall is left exactly as it is. A missing port 80 or 443 rule can block the site or certificate renewal." \
    "Yes. Add the missing allows and leave the rest of the firewall alone."; then
    echo "No firewall rules were added."
    return 0
  fi
  if ! ufw_allows_ssh; then
    ufw_allow_ssh
  fi
  if ! ufw_allows_port 80; then
    run_root ufw allow 80/tcp comment 'HTTP for nginx sites'
  fi
  if ! ufw_allows_port 443; then
    run_root ufw allow 443/tcp comment 'HTTPS for nginx sites'
  fi
  run_root ufw status verbose
}

# /etc/letsencrypt/live is mode 700 and owned by root. The administrator
# running this script cannot see those files without sudo.
root_file_exists() {
  run_root test -f "$1"
}

certificate_end_epoch() {
  local end
  end="$(run_root openssl x509 -enddate -noout -in "$1" | cut -d= -f2-)"
  date -d "$end" +%s
}

certificate_days_left() {
  local end_epoch now
  end_epoch="$(certificate_end_epoch "$1")"
  now="$(date +%s)"
  if (( end_epoch <= now )); then
    echo 0
    return 0
  fi
  echo $(( (end_epoch - now) / 86400 ))
}

certificate_still_valid() {
  local end_epoch now
  end_epoch="$(certificate_end_epoch "$1")"
  now="$(date +%s)"
  (( end_epoch > now ))
}

certificate_covers_fqdn() {
  local cert="$1" text escaped
  text="$(run_root openssl x509 -in "$cert" -noout -subject -ext subjectAltName 2>/dev/null \
    || run_root openssl x509 -in "$cert" -noout -subject)"
  escaped="${FQDN//./\\.}"
  grep -Eq "(^|[[:space:],])DNS:${escaped}([[:space:],]|$)" <<<"$text" \
    || grep -Eq "CN[[:space:]]*=[[:space:]]*${escaped}([[:space:],]|$)" <<<"$text"
}

# A pair is valid when both files exist, the certificate is unexpired, and it
# names this FQDN. Sets CERT_FILE and KEY_FILE.
certificate_pair_valid() {
  local name="$1" cert key
  cert="/etc/letsencrypt/live/${name}/fullchain.pem"
  key="/etc/letsencrypt/live/${name}/privkey.pem"
  root_file_exists "$cert" || return 1
  root_file_exists "$key" || return 1
  certificate_still_valid "$cert" || return 1
  certificate_covers_fqdn "$cert" || return 1
  CERT_FILE="$cert"
  KEY_FILE="$key"
}

find_certificate_paths() {
  local name
  CERT_FILE=""
  KEY_FILE=""
  if certificate_pair_valid "$FQDN"; then
    return 0
  fi
  while read -r name; do
    [[ -n "$name" && "$name" != "README" && "$name" != "$FQDN" ]] || continue
    if certificate_pair_valid "$name"; then
      return 0
    fi
  done < <(run_root ls -1 /etc/letsencrypt/live 2>/dev/null || true)
  CERT_FILE=""
  KEY_FILE=""
  return 1
}

enable_certbot_timer() {
  if run_root systemctl list-unit-files certbot.timer --no-legend 2>/dev/null | grep -q certbot.timer; then
    run_root systemctl enable --now certbot.timer
  fi
}

obtain_certificate() {
  step "TLS certificate for ${FQDN}"
  local cert
  local days
  if find_certificate_paths; then
    days="$(certificate_days_left "$CERT_FILE")"
    echo "A valid Let's Encrypt certificate for ${FQDN} is already on this system (${days} days left)."
    echo "Skipping the certificate request. nginx will use ${CERT_FILE}."
    enable_certbot_timer
    return 0
  fi
  cert="/etc/letsencrypt/live/${FQDN}/fullchain.pem"
  echo "This requests a Let's Encrypt certificate for ${FQDN} and agrees to the Let's Encrypt subscriber agreement."
  echo "DNS for ${FQDN} must already point at this server, and TCP 80 must be reachable."
  if ! fqdn_resolves_locally; then
    echo "${FQDN} does not resolve to an address on this host ($(hostname -I))."
    echo "A host behind NAT can still be correct when public DNS points at this machine."
  fi
  if ! ask "Request a Let's Encrypt certificate for ${FQDN}?" y \
    "Certbot requests a certificate for ${FQDN} using the HTTP challenge. You accept Let's Encrypt's terms of service. nginx then serves HTTPS for this name." \
    "The installer stops. There is no TLS certificate, so the public HTTPS site is not configured." \
    "Yes. Request the certificate so https://${FQDN}/ can be served."; then
    die "Cannot publish https://${FQDN}/ without a certificate."
  fi
  run_root certbot certonly \
    --webroot -w "$ACME_WEBROOT" \
    -d "$FQDN" \
    --non-interactive \
    --agree-tos \
    --email "$LE_EMAIL" \
    --keep-until-expiring
  if ! root_file_exists "$cert"; then
    die "Certificate files for ${FQDN} were not created."
  fi
  CERT_FILE="$cert"
  KEY_FILE="/etc/letsencrypt/live/${FQDN}/privkey.pem"
  enable_certbot_timer
}

install_nginx_https() {
  step "HTTPS vhost"
  echo "Wiring ${CERT_FILE:-/etc/letsencrypt/live/${FQDN}/fullchain.pem} into ${NGINX_SITE_AVAILABLE}."
  render_https_site
  enable_site_link
  reload_nginx
}

maybe_backup_timer() {
  step "Backup timer"
  if ! ask "Enable the daily 03:00 backup timer as user ${APP_USER}?" y \
    "systemd runs the TaskMesh backup once a day at 03:00 as ${APP_USER}, including when the app process is down." \
    "No backup timer is installed. Backups still run from the app's own scheduler while the process is up." \
    "Yes. Add the timer so a backup still runs if the app is stopped."; then
    echo "Backup timer was not enabled. The app can still schedule backups while it is running."
    return 0
  fi
  if ! install_systemd_unit "${APP_ROOT}/deploy/taskmesh-backup.service" /etc/systemd/system/taskmesh-backup.service; then
    echo "Left the existing backup unit unchanged. The timer was not enabled."
    return 0
  fi
  run_root install -m 644 "${APP_ROOT}/deploy/taskmesh-backup.timer" /etc/systemd/system/taskmesh-backup.timer
  run_root systemctl daemon-reload
  run_root systemctl enable --now taskmesh-backup.timer
}

fqdn_resolves_locally() {
  local dns_ip local_ips
  local_ips=" $(hostname -I) "
  while read -r dns_ip; do
    if [[ "$local_ips" == *" ${dns_ip} "* ]]; then
      return 0
    fi
  done < <(getent ahosts "$FQDN" 2>/dev/null | awk '{print $1}' | sort -u || true)
  return 1
}

verify() {
  step "Verify"
  curl -fsS http://127.0.0.1:3000/api/health >/dev/null || die "Health check failed on http://127.0.0.1:3000/api/health"
  curl -fsS --resolve "${FQDN}:443:127.0.0.1" "https://${FQDN}/api/health" >/dev/null \
    || die "Health check failed for https://${FQDN}/api/health via the nginx vhost."
  local redirect
  redirect="$(curl -sI --resolve "${FQDN}:80:127.0.0.1" "http://${FQDN}/api/health" | awk 'BEGIN{IGNORECASE=1} /^location:/ { print $2 }' | tr -d '\r')"
  if [[ "$redirect" != "https://${FQDN}/api/health" ]]; then
    die "HTTP did not redirect to https://${FQDN}/api/health (got ${redirect:-no Location header})."
  fi
  if ! fqdn_resolves_locally && ! getent ahosts "$FQDN" >/dev/null; then
    die "${FQDN} does not resolve. Point DNS at this server and re-run the installer."
  fi
  if ! curl -fsS --max-time 20 "https://${FQDN}/api/health" >/dev/null; then
    die "https://${FQDN}/api/health did not succeed from this server. Check DNS and that TCP 443 is reachable."
  fi
  echo ""
  echo "TaskMesh is installed."
  echo "  URL:       https://${FQDN}/"
  echo "  Health:    https://${FQDN}/api/health"
  echo "  Service:   systemctl status ${APP_USER} --no-pager"
  echo "  Logs:      journalctl -u ${APP_USER} -n 50 --no-pager"
  echo "  Env file:  ${APP_ROOT}/.env (mode 600, owner ${APP_USER})"
  if [[ "$DB_PASS_GENERATED" -eq 1 ]]; then
    show_on_tty "Database password (also in ${APP_ROOT}/.env, shown only on this terminal):"
    show_on_tty "$DB_PASS"
  fi
  if [[ "$ADMIN_PASS_GENERATED" -eq 1 ]]; then
    show_on_tty "Administrator sign-in for https://${FQDN}/ (shown only on this terminal):"
    show_on_tty "  Email:    ${ADMIN_EMAIL}"
    show_on_tty "  Password: ${ADMIN_PASS}"
  elif [[ -n "$ADMIN_EMAIL" ]]; then
    echo "  Sign in:   ${ADMIN_EMAIL} at https://${FQDN}/"
  fi
  echo ""
  echo "Updates:"
  echo "  sudo -u ${APP_USER} -H bash -lc 'cd ${APP_ROOT} && git pull --ff-only && npm install && npm install --prefix client && npm run db:migrate && npm run build:all'"
  echo "  sudo systemctl restart ${APP_USER}"
}

expect_fail() {
  if "$@"; then
    die "expected failure: $*"
  fi
}

self_test() {
  is_fqdn "tasks.example.com" || die "expected tasks.example.com"
  is_fqdn "my-app.example.com" || die "expected my-app.example.com"
  is_fqdn "a.bc" || die "expected a.bc"
  is_fqdn "TASKS.Example.COM" || die "expected mixed case"
  expect_fail is_fqdn "https://tasks.example.com"
  expect_fail is_fqdn "tasks.example.com/app"
  expect_fail is_fqdn "tasks.example.com:443"
  expect_fail is_fqdn "localhost"
  expect_fail is_fqdn "192.168.1.1"
  expect_fail is_fqdn "tasks.example.com."
  expect_fail is_fqdn "-bad.example.com"
  is_email "ops@example.com" || die "email should pass"
  expect_fail is_email "not-an-email"
  is_db_password "abcdefghijklmnop" || die "password should pass"
  expect_fail is_db_password "short"
  expect_fail is_db_password "abcdefghijklmnop/"
  if command -v apt-cache >/dev/null 2>&1; then
    local candidate
    candidate="$(apt_candidate_version bash)"
    [[ -n "$candidate" && "$candidate" != "(none)" ]] || die "could not read the apt candidate version"
  fi
  echo "self-test ok"
}

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      exit 0
      ;;
    --self-test)
      self_test
      exit 0
      ;;
    --check)
      CHECK_ONLY=1
      ;;
    "")
      ;;
    *)
      die "Unknown argument: $1 (use --check, --self-test, or --help)"
      ;;
  esac

  setup_colors
  export DEBIAN_FRONTEND=noninteractive
  export NEEDRESTART_MODE=a
  detect_source_root
  detect_ssh_port
  require_admin
  require_ubuntu

  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    run_check
    exit 0
  fi

  require_tty
  collect_inputs
  apt_update
  install_base_packages
  install_postgres_packages
  install_node
  install_web_packages
  ensure_service_user
  ensure_database
  ensure_app_tree
  ensure_env
  npm_install_and_build
  install_systemd
  install_nginx_http
  configure_firewall
  obtain_certificate
  install_nginx_https
  maybe_backup_timer
  verify
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
