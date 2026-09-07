"""Postgres privilege / role sanity checks via psql + DATABASE_URL."""

from __future__ import annotations

import os
import subprocess
from urllib.parse import unquote, urlparse

from lib.result import CheckResult, ScanContext

MODULE = "db_postgres"

DB_HELP = (
    "App DB role should be least-privilege: not superuser, no CREATEDB, dedicated taskmesh database.",
    "Docs: SECURITY.md “Secrets and host hardening” · INSTALL.md (Postgres role setup).",
    "Connection uses libpq env derived from DATABASE_URL (supports special chars in passwords).",
)

DB_SKIP_URL_HELP = (
    "Set DATABASE_URL in process env, repo .env, or --env-file to enable DB checks.",
    *DB_HELP,
)


def _connection_env(database_url: str) -> dict[str, str]:
    """
    Build libpq env vars so passwords with '@', '*', etc. work even when the
    URI in .env is not fully percent-encoded.
    """
    parsed = urlparse(database_url)
    if parsed.scheme not in ("postgresql", "postgres"):
        raise ValueError(f"Unsupported DATABASE_URL scheme: {parsed.scheme!r}")

    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    host = parsed.hostname or "127.0.0.1"
    port = str(parsed.port or 5432)
    dbname = unquote((parsed.path or "/").lstrip("/") or "postgres")

    # If password contained an unencoded '@', urlparse may have folded part of
    # the password into the hostname. Recover by splitting on the last '@'
    # only when hostname looks wrong (contains atypical chars for a host).
    if parsed.password is None and "@" in database_url:
        # Fallback: postgresql://user:pass@with@host:port/db
        try:
            after_scheme = database_url.split("://", 1)[1]
            creds, _, hostpart = after_scheme.rpartition("@")
            user, _, password = creds.partition(":")
            hostport, _, dbname = hostpart.partition("/")
            if ":" in hostport:
                host, _, port = hostport.partition(":")
            else:
                host, port = hostport, "5432"
            user, password, host, dbname = (
                unquote(user),
                unquote(password),
                host,
                unquote(dbname.split("?")[0]),
            )
        except Exception as e:  # noqa: BLE001
            raise ValueError(f"Could not parse DATABASE_URL: {e}") from e

    return {
        "PGHOST": host,
        "PGPORT": port,
        "PGUSER": user,
        "PGPASSWORD": password,
        "PGDATABASE": dbname,
    }


def _psql_query(database_url: str, sql: str) -> tuple[int, str, str]:
    env = {**os.environ, **_connection_env(database_url)}
    proc = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def run(ctx: ScanContext, _client=None) -> list[CheckResult]:
    results: list[CheckResult] = []

    if not ctx.database_url:
        return [
            CheckResult(
                MODULE,
                "DATABASE_URL",
                "skip",
                "No DATABASE_URL in process env, repo .env, or --env-file",
                help=DB_SKIP_URL_HELP,
            )
        ]

    try:
        _connection_env(ctx.database_url)
    except ValueError as e:
        return [CheckResult(MODULE, "DATABASE_URL parse", "fail", str(e))]

    try:
        code, out, err = _psql_query(
            ctx.database_url,
            "SELECT current_user || '|' || current_database() || '|' || "
            "COALESCE((SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user), 'unknown');",
        )
    except FileNotFoundError:
        return [
            CheckResult(MODULE, "psql availability", "skip", "psql not found on PATH", help=(
                "Install PostgreSQL client tools (`psql`) to run DB privilege checks.",
                *DB_HELP,
            ))
        ]
    except ValueError as e:
        return [CheckResult(MODULE, "DATABASE_URL parse", "fail", str(e))]

    if code != 0:
        return [
            CheckResult(
                MODULE,
                "connect",
                "skip",
                f"Could not connect/query via psql (exit {code}): {err[:200] or out[:200]}",
                help=(
                    "Verify DATABASE_URL and that Postgres is reachable from this host.",
                    *DB_HELP,
                ),
            )
        ]

    parts = out.split("|")
    if len(parts) < 3:
        return [
            CheckResult(
                MODULE,
                "role query",
                "fail",
                f"Unexpected psql output: {out!r}",
            )
        ]

    cur_user, cur_db, rolsuper = parts[0], parts[1], parts[2]
    results.append(
        CheckResult(
            MODULE,
            "connect",
            "pass",
            f"Connected as {cur_user} to database {cur_db}",
        )
    )

    if rolsuper.lower() in ("t", "true", "1", "yes"):
        results.append(
            CheckResult(
                MODULE,
                "role not superuser",
                "fail",
                f"Role {cur_user} is a PostgreSQL superuser — least privilege violated",
                help=DB_HELP,
            )
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "role not superuser",
                "pass",
                f"Role {cur_user} is not superuser (rolsuper={rolsuper})",
            )
        )

    if "taskmesh" in cur_db.lower():
        results.append(
            CheckResult(
                MODULE,
                "expected database name",
                "pass",
                f"Database name looks like TaskMesh ({cur_db})",
            )
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "expected database name",
                "fail",
                f"Connected database {cur_db!r} does not look like taskmesh",
            )
        )

    code2, out2, err2 = _psql_query(
        ctx.database_url,
        "SELECT rolcreatedb::text FROM pg_roles WHERE rolname = current_user;",
    )
    if code2 != 0:
        results.append(
            CheckResult(
                MODULE,
                "rolcreatedb",
                "skip",
                f"Could not read rolcreatedb: {err2[:160]}",
            )
        )
    elif out2.lower() in ("t", "true"):
        results.append(
            CheckResult(
                MODULE,
                "rolcreatedb",
                "fail",
                f"App role {cur_user} has CREATEDB — prefer least privilege",
                help=DB_HELP,
            )
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "rolcreatedb",
                "pass",
                f"Role {cur_user} does not have CREATEDB",
            )
        )

    return results
