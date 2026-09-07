"""CSRF gate checks for cookie-authenticated mutating requests."""

from __future__ import annotations

from lib.http_client import HttpClient
from lib.result import CheckResult, ScanContext

MODULE = "http_csrf"
PROBE_PATH = "/api/v1/tasks/999999999"

CREDS_HELP = (
    "Provide TASKMESH_EMAIL + TASKMESH_PASSWORD via ~/.config/taskmesh/worktask.env, "
    "--env-file, process env, or --prompt-creds.",
    "API keys alone skip this module (CSRF does not apply to key auth).",
    "CSRF rules: SECURITY.md · src/middleware/csrfProtection.ts (X-TaskMesh-Client: ui + same-origin Origin).",
)

CSRF_FAIL_HELP = (
    "Mutating cookie-session requests must send header X-TaskMesh-Client: ui and same-origin Origin/Referer.",
    "Implementation: src/middleware/csrfProtection.ts · docs: SECURITY.md (CSRF T0087).",
    "Probe uses PATCH /api/v1/tasks/999999999 — 403 csrf_rejected expected without SPA header / with evil Origin.",
)


def run(ctx: ScanContext, client: HttpClient) -> list[CheckResult]:
    results: list[CheckResult] = []

    if ctx.api_key and not (ctx.email and ctx.password):
        return [
            CheckResult(
                MODULE,
                "csrf session checks",
                "skip",
                "API key auth bypasses CSRF by design; need email/password session to assert CSRF gate",
                help=CREDS_HELP,
            )
        ]

    if not ctx.email or not ctx.password:
        return [
            CheckResult(
                MODULE,
                "csrf session checks",
                "skip",
                "No session credentials; CSRF checks require cookie login",
                help=CREDS_HELP,
            )
        ]

    c = HttpClient(ctx.base_url)
    try:
        login = c.login(ctx.email, ctx.password)
    except OSError as e:
        return [CheckResult(MODULE, "login for csrf", "fail", str(e))]

    if login.status != 200 or not c.session_cookie_value():
        return [
            CheckResult(
                MODULE,
                "login for csrf",
                "fail",
                f"Could not establish session (status={login.status})",
            )
        ]

    try:
        missing = c.patch(
            PROBE_PATH,
            json_body={"title": "csrf-probe"},
            headers={"Origin": ctx.base_url},
        )
    except OSError as e:
        return [CheckResult(MODULE, "csrf missing header", "fail", str(e))]

    body = missing.text()
    if missing.status == 403 and ("csrf" in body.lower() or "csrf_rejected" in body):
        results.append(
            CheckResult(
                MODULE,
                "reject without X-TaskMesh-Client",
                "pass",
                "403 csrf_rejected without SPA client header",
            )
        )
    elif missing.status == 403:
        results.append(
            CheckResult(
                MODULE,
                "reject without X-TaskMesh-Client",
                "pass",
                f"403 without SPA client header ({body[:120]})",
            )
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "reject without X-TaskMesh-Client",
                "fail",
                f"Expected 403 csrf_rejected without SPA header, got {missing.status}: {body[:180]}",
                help=CSRF_FAIL_HELP,
            )
        )

    try:
        cross = c.patch(
            PROBE_PATH,
            json_body={"title": "csrf-probe"},
            headers={
                "X-TaskMesh-Client": "ui",
                "Origin": "https://evil.example",
            },
        )
    except OSError as e:
        results.append(CheckResult(MODULE, "reject cross-origin", "fail", str(e)))
        return results

    if cross.status == 403:
        results.append(
            CheckResult(
                MODULE,
                "reject cross-origin Origin",
                "pass",
                "403 when Origin host does not match request host",
            )
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "reject cross-origin Origin",
                "fail",
                f"Expected 403 for cross-origin mutate, got {cross.status}",
                help=CSRF_FAIL_HELP,
            )
        )

    try:
        ok = c.patch(
            PROBE_PATH,
            json_body={"title": "csrf-probe"},
            headers={
                "X-TaskMesh-Client": "ui",
                "Origin": ctx.base_url,
            },
        )
    except OSError as e:
        results.append(CheckResult(MODULE, "allow same-origin with header", "fail", str(e)))
        return results

    if ok.status == 403 and "csrf" in ok.text().lower():
        results.append(
            CheckResult(
                MODULE,
                "allow same-origin with header",
                "fail",
                f"CSRF still rejected valid SPA headers: {ok.text()[:180]}",
                help=CSRF_FAIL_HELP,
            )
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "allow same-origin with header",
                "pass",
                f"CSRF gate passed (status {ok.status}; 404/400 after CSRF is OK)",
            )
        )

    return results
