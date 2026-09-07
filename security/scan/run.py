#!/usr/bin/env python3
"""TaskMesh defensive security scan suite (T0121).

Run from repo root:
  python3 security/scan/run.py
  npm run security:scan -- --base-url http://127.0.0.1:3001

Defensive assertions only — no exploit payloads.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow `python3 security/scan/run.py` without installing a package.
SCAN_DIR = Path(__file__).resolve().parent
if str(SCAN_DIR) not in sys.path:
    sys.path.insert(0, str(SCAN_DIR))

from lib.env_creds import load_scan_secrets, resolve_repo_root  # noqa: E402
from lib.http_client import HttpClient  # noqa: E402
from lib.report import print_header, print_result, print_summary, write_html_log  # noqa: E402
from lib.result import CheckResult, ScanContext  # noqa: E402
from modules import db_postgres  # noqa: E402
from modules import http_api_surface  # noqa: E402
from modules import http_auth  # noqa: E402
from modules import http_csrf  # noqa: E402
from modules import http_headers  # noqa: E402
from modules import repo_npm_audit  # noqa: E402
from modules import repo_static  # noqa: E402

DEFAULT_BASE = "http://127.0.0.1:3000"

MODULE_RUNNERS = {
    "http_headers": http_headers.run,
    "http_auth": http_auth.run,
    "http_csrf": http_csrf.run,
    "http_api": http_api_surface.run,
    "repo_static": repo_static.run,
    "repo_npm_audit": repo_npm_audit.run,
    "db_postgres": db_postgres.run,
}

HTTP_MODULES = {"http_headers", "http_auth", "http_csrf", "http_api"}
REPO_MODULES = {"repo_static", "repo_npm_audit"}
DB_MODULES = {"db_postgres"}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="TaskMesh defensive security scan (HTTP + repo + optional DB)."
    )
    p.add_argument(
        "--base-url",
        default=DEFAULT_BASE,
        help=f"App base URL (default: {DEFAULT_BASE} PROD)",
    )
    p.add_argument(
        "--env-file",
        default=None,
        help="Env file with TASKMESH_EMAIL/PASSWORD and/or TASKMESH_API_KEY "
        "(default: ~/.config/taskmesh/worktask.env if present)",
    )
    p.add_argument(
        "--prompt-creds",
        action="store_true",
        help="Prompt for email/password when missing (authenticated checks)",
    )
    p.add_argument("--skip-http", action="store_true", help="Skip HTTP modules")
    p.add_argument("--skip-repo", action="store_true", help="Skip repo modules")
    p.add_argument("--skip-db", action="store_true", help="Skip database modules")
    p.add_argument(
        "--modules",
        default=None,
        help="Comma-separated module names to run (default: all applicable)",
    )
    p.add_argument(
        "--no-html",
        action="store_true",
        help="Do not write HTML log under security/scan/logs/",
    )
    p.add_argument(
        "--fail-on-findings",
        action="store_true",
        help="Exit 1 when any check FAILs (default: exit 0 if the runner completed; "
        "findings are still printed). Useful for CI gates (T0086).",
    )
    return p.parse_args(argv)


def select_modules(args: argparse.Namespace) -> list[str]:
    if args.modules:
        names = [m.strip() for m in args.modules.split(",") if m.strip()]
        unknown = [m for m in names if m not in MODULE_RUNNERS]
        if unknown:
            raise SystemExit(f"Unknown modules: {', '.join(unknown)}")
        return names

    names = list(MODULE_RUNNERS.keys())
    if args.skip_http:
        names = [m for m in names if m not in HTTP_MODULES]
    if args.skip_repo:
        names = [m for m in names if m not in REPO_MODULES]
    if args.skip_db:
        names = [m for m in names if m not in DB_MODULES]
    return names


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    started = datetime.now(timezone.utc)
    repo_root = resolve_repo_root()
    secrets = load_scan_secrets(
        env_file=args.env_file,
        prompt_creds=args.prompt_creds,
        repo_root=repo_root,
    )

    ctx = ScanContext(
        base_url=args.base_url.rstrip("/"),
        repo_root=str(repo_root) if repo_root else None,
        env_file=args.env_file or secrets.get("env_file_loaded"),
        prompt_creds=args.prompt_creds,
        skip_http=args.skip_http,
        skip_repo=args.skip_repo,
        skip_db=args.skip_db,
        write_html=not args.no_html,
        email=secrets.get("email"),
        password=secrets.get("password"),
        api_key=secrets.get("api_key"),
        database_url=secrets.get("database_url"),
    )

    print_header(ctx.base_url, started)
    if ctx.env_file:
        print(f"  Creds file: {ctx.env_file}")
    elif ctx.api_key or (ctx.email and ctx.password):
        print("  Creds: from process environment")
    else:
        print("  Creds: none (auth-gated checks will SKIP)")
    if ctx.repo_root:
        print(f"  Repo root: {ctx.repo_root}")
    else:
        print("  Repo root: not detected (repo modules will SKIP)")
    print()

    client = HttpClient(ctx.base_url)
    results: list[CheckResult] = []

    # Establish session early when password creds exist so later HTTP modules can reuse.
    if ctx.email and ctx.password and not args.skip_http:
        try:
            login = client.login(ctx.email, ctx.password)
            if login.status == 200 and client.session_cookie_value():
                ctx.session_cookie = client.session_cookie_value()
        except OSError:
            pass

    for name in select_modules(args):
        runner = MODULE_RUNNERS[name]
        print(f"{name}")
        try:
            module_results = runner(ctx, client)
        except Exception as e:  # noqa: BLE001 — surface as failed check, keep suite going
            module_results = [
                CheckResult(name, "module error", "fail", f"Unhandled error: {e}")
            ]
        for r in module_results:
            print_result(r)
            results.append(r)
        print()

    html_path = None
    if ctx.write_html:
        logs_dir = SCAN_DIR / "logs"
        html_path = write_html_log(
            results, base_url=ctx.base_url, started=started, out_dir=logs_dir
        )

    print_summary(results, html_path)

    # Findings (FAIL checks) are reported in console/HTML only.
    # Exit 0 means the scan runner completed successfully so `npm run security:scan` is green.
    # Use --fail-on-findings when a non-zero exit on FAIL rows is required (e.g. future CI).
    if args.fail_on_findings and any(r.status == "fail" for r in results):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
