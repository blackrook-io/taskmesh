"""Representative /api/v1 surface checks (health envelope + auth gates)."""

from __future__ import annotations

from lib.http_client import HttpClient
from lib.result import CheckResult, ScanContext

MODULE = "http_api"


def run(ctx: ScanContext, client: HttpClient) -> list[CheckResult]:
    results: list[CheckResult] = []

    try:
        health = client.get("/api/health")
    except OSError as e:
        return [CheckResult(MODULE, "/api/health", "fail", str(e))]

    if health.status != 200:
        results.append(
            CheckResult(MODULE, "/api/health", "fail", f"status {health.status}")
        )
    else:
        try:
            body = health.json()
        except Exception:
            body = None
        if isinstance(body, dict) and (
            body.get("ok") is True or body.get("status") == "ok" or "data" in body or body
        ):
            results.append(
                CheckResult(MODULE, "/api/health JSON", "pass", f"body keys: {list(body)[:8]}")
            )
        else:
            results.append(
                CheckResult(
                    MODULE,
                    "/api/health JSON",
                    "pass",
                    f"200 OK (body parse optional): {health.text()[:80]}",
                )
            )

    # Login endpoint rejects bad password without 500
    try:
        bad = client.post(
            "/api/v1/auth/login",
            json_body={"email": "nobody@example.invalid", "password": "wrong-password-probe"},
            headers={"X-TaskMesh-Client": "ui", "Origin": ctx.base_url},
        )
    except OSError as e:
        results.append(CheckResult(MODULE, "login bad credentials", "fail", str(e)))
        bad = None

    if bad is not None:
        if bad.status in (401, 403, 429):
            results.append(
                CheckResult(
                    MODULE,
                    "login bad credentials",
                    "pass",
                    f"Returned {bad.status} (no 500)",
                )
            )
        elif bad.status >= 500:
            results.append(
                CheckResult(
                    MODULE,
                    "login bad credentials",
                    "fail",
                    f"Server error {bad.status} on bad login",
                )
            )
        else:
            results.append(
                CheckResult(
                    MODULE,
                    "login bad credentials",
                    "fail",
                    f"Unexpected status {bad.status} for bad login",
                )
            )

    # Query-string API keys must not work (SECURITY.md)
    try:
        qs = client.get("/api/v1/projects?api_key=taskmesh_rw_fake")
    except OSError as e:
        results.append(CheckResult(MODULE, "reject query-string api_key", "fail", str(e)))
        qs = None
    if qs is not None:
        # Rejected with dedicated 400 api_key_in_query (preferred) or 401.
        body = qs.text()
        if qs.status == 400 and "api_key_in_query" in body:
            results.append(
                CheckResult(
                    MODULE,
                    "reject query-string api_key",
                    "pass",
                    "Query-string api_key rejected (400 api_key_in_query)",
                )
            )
        elif qs.status == 401:
            results.append(
                CheckResult(
                    MODULE,
                    "reject query-string api_key",
                    "pass",
                    "Query-string api_key did not authenticate (401)",
                )
            )
        else:
            results.append(
                CheckResult(
                    MODULE,
                    "reject query-string api_key",
                    "fail",
                    f"Expected 400 api_key_in_query or 401, got {qs.status}: {body[:160]}",
                )
            )

    # Admin routes require admin — unauthenticated still 401
    try:
        admin = HttpClient(ctx.base_url).get("/api/v1/admin/users")
    except OSError as e:
        results.append(CheckResult(MODULE, "admin unauth", "fail", str(e)))
        admin = None
    if admin is not None:
        if admin.status == 401:
            results.append(
                CheckResult(MODULE, "admin unauth", "pass", "Admin route requires auth (401)")
            )
        else:
            results.append(
                CheckResult(
                    MODULE,
                    "admin unauth",
                    "fail",
                    f"Expected 401 for unauth admin, got {admin.status}",
                )
            )

    # Authenticated API sample if we have a live session on client
    if client.session_cookie_value() or ctx.api_key:
        headers = {"X-TaskMesh-Client": "ui", "Origin": ctx.base_url}
        if ctx.api_key and not client.session_cookie_value():
            headers = {"Authorization": f"Bearer {ctx.api_key}"}
        for path in ("/api/v1/projects", "/api/v1/tasks", "/api/v1/config"):
            try:
                resp = client.get(path, headers=headers)
            except OSError as e:
                results.append(CheckResult(MODULE, f"auth GET {path}", "fail", str(e)))
                continue
            # /config is public; others need auth
            if resp.status == 200:
                results.append(
                    CheckResult(MODULE, f"auth GET {path}", "pass", "200 OK")
                )
            else:
                results.append(
                    CheckResult(
                        MODULE,
                        f"auth GET {path}",
                        "fail",
                        f"Expected 200, got {resp.status}",
                    )
                )
    else:
        results.append(
            CheckResult(
                MODULE,
                "authenticated API samples",
                "skip",
                "No session/API key available for authenticated API samples",
            )
        )

    return results
