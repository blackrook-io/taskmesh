"""Public allowlist + unauthenticated protection checks."""

from __future__ import annotations

from lib.http_client import HttpClient
from lib.result import CheckResult, ScanContext

MODULE = "http_auth"

# (method, path, expect_status_or_callable description)
PUBLIC_OK = [
    ("GET", "/api/health", {200}),
    # Public route (auth middleware allows); handler returns 401 when anonymous.
    ("GET", "/api/v1/auth/session", {200, 401}),
    ("GET", "/api/v1/config", {200}),
]


PROTECTED_UNAUTH = [
    ("GET", "/api/v1/projects"),
    ("GET", "/api/v1/ideas"),
    ("GET", "/api/v1/tasks"),
    ("GET", "/api/v1/users/me"),
    ("GET", "/api/v1/search?q=test"),
]

AUTH_HELP = (
    "Public allowlist: POST /auth/login|logout, GET /auth/session, GET /config* "
    "(src/middleware/requireAuth.ts · SECURITY.md).",
    "Protected /api/v1/* without session/API key must return 401 not_authenticated.",
)

CREDS_SKIP_HELP = (
    "Optional: set TASKMESH_EMAIL/PASSWORD or TASKMESH_API_KEY "
    "(~/.config/taskmesh/worktask.env, --env-file, or --prompt-creds) for login smoke.",
    "Unauthenticated checks above still validate the auth gate without credentials.",
    "Docs: security/scan/README.md",
)


def run(ctx: ScanContext, client: HttpClient) -> list[CheckResult]:
    results: list[CheckResult] = []
    anon = HttpClient(ctx.base_url)  # no cookies

    for method, path, expected in PUBLIC_OK:
        try:
            resp = anon.request(method, path)
        except OSError as e:
            results.append(
                CheckResult(MODULE, f"public {method} {path}", "fail", f"Request failed: {e}")
            )
            continue
        if resp.status in expected:
            results.append(
                CheckResult(
                    MODULE,
                    f"public {method} {path}",
                    "pass",
                    f"Returned {resp.status} without auth middleware block",
                )
            )
        else:
            results.append(
                CheckResult(
                    MODULE,
                    f"public {method} {path}",
                    "fail",
                    f"Expected {sorted(expected)}, got {resp.status}: {resp.text()[:180]}",
                    help=AUTH_HELP,
                )
            )

    for method, path in PROTECTED_UNAUTH:
        try:
            resp = anon.request(method, path)
        except OSError as e:
            results.append(
                CheckResult(MODULE, f"unauth {method} {path}", "fail", f"Request failed: {e}")
            )
            continue
        if resp.status == 401:
            results.append(
                CheckResult(
                    MODULE,
                    f"unauth {method} {path}",
                    "pass",
                    "Correctly returned 401 not_authenticated",
                )
            )
        else:
            results.append(
                CheckResult(
                    MODULE,
                    f"unauth {method} {path}",
                    "fail",
                    f"Expected 401 without credentials, got {resp.status}",
                    help=AUTH_HELP,
                )
            )

    # Authenticated smoke: login or API key
    if ctx.api_key:
        auth_client = HttpClient(ctx.base_url)
        try:
            resp = auth_client.get(
                "/api/v1/projects",
                headers={"Authorization": f"Bearer {ctx.api_key}"},
            )
        except OSError as e:
            results.append(CheckResult(MODULE, "api key GET /projects", "fail", str(e)))
            return results
        if resp.status == 200:
            results.append(
                CheckResult(MODULE, "api key GET /projects", "pass", "API key authenticated GET OK")
            )
        else:
            results.append(
                CheckResult(
                    MODULE,
                    "api key GET /projects",
                    "fail",
                    f"Expected 200 with API key, got {resp.status}: {resp.text()[:180]}",
                )
            )
        return results

    if not ctx.email or not ctx.password:
        results.append(
            CheckResult(
                MODULE,
                "session login smoke",
                "skip",
                "No TASKMESH_EMAIL/PASSWORD or API key (use --env-file, worktask.env, or --prompt-creds)",
                help=CREDS_SKIP_HELP,
            )
        )
        return results

    try:
        login = client.login(ctx.email, ctx.password)
    except OSError as e:
        results.append(CheckResult(MODULE, "session login", "fail", f"Login request failed: {e}"))
        return results

    if login.status != 200:
        results.append(
            CheckResult(
                MODULE,
                "session login",
                "fail",
                f"Login returned {login.status}: {login.text()[:200]}",
            )
        )
        return results

    if not client.session_cookie_value():
        results.append(
            CheckResult(
                MODULE,
                "session cookie",
                "fail",
                "Login succeeded but no taskmesh_session cookie was captured",
            )
        )
        return results

    results.append(CheckResult(MODULE, "session login", "pass", "Login OK; session cookie captured"))

    try:
        projects = client.get(
            "/api/v1/projects",
            headers={
                "X-TaskMesh-Client": "ui",
                "Origin": ctx.base_url,
            },
        )
    except OSError as e:
        results.append(CheckResult(MODULE, "session GET /projects", "fail", str(e)))
        return results

    if projects.status == 200:
        results.append(
            CheckResult(MODULE, "session GET /projects", "pass", "Authenticated list OK")
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "session GET /projects",
                "fail",
                f"Expected 200, got {projects.status}: {projects.text()[:180]}",
            )
        )

    return results
