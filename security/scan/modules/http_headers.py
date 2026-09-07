"""HTTP security header checks."""

from __future__ import annotations

from lib.http_client import HttpClient
from lib.result import CheckResult, ScanContext

MODULE = "http_headers"

REQUIRED = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
}

HEADERS_HELP = (
    "Expected headers are set in src/middleware/securityHeaders.ts (see SECURITY.md “HTTP headers”).",
    "PROD (NODE_ENV=production) must also send Content-Security-Policy; DEV :3001 omits CSP by design.",
    "Docs: SECURITY.md · security/scan/README.md",
)

CSP_DEV_SKIP_HELP = (
    "DEV API intentionally skips CSP so Vite HMR works.",
    "Re-run against PROD default http://127.0.0.1:3000 to assert CSP.",
    "Implementation: src/middleware/securityHeaders.ts",
)


def run(ctx: ScanContext, client: HttpClient) -> list[CheckResult]:
    results: list[CheckResult] = []
    try:
        resp = client.get("/api/health")
    except OSError as e:
        return [
            CheckResult(
                MODULE,
                "reachability",
                "fail",
                f"Cannot reach {ctx.base_url}/api/health: {e}",
                help=(
                    "Is the target running? PROD systemd :3000 or DEV `npm run dev` :3001.",
                    f"Try: curl -i {ctx.base_url}/api/health",
                    "Override target with --base-url.",
                ),
            )
        ]

    if resp.status != 200:
        results.append(
            CheckResult(
                MODULE,
                "health status",
                "fail",
                f"Expected 200 from /api/health, got {resp.status}",
                help=HEADERS_HELP,
            )
        )
    else:
        results.append(
            CheckResult(MODULE, "health status", "pass", f"/api/health returned {resp.status}")
        )

    for header, expected in REQUIRED.items():
        actual = resp.header(header)
        if actual is None:
            results.append(
                CheckResult(
                    MODULE,
                    header,
                    "fail",
                    f"Missing header {header} (expected value containing '{expected}')",
                    help=HEADERS_HELP,
                )
            )
        elif expected.lower() not in actual.lower():
            results.append(
                CheckResult(
                    MODULE,
                    header,
                    "fail",
                    f"Header {header}={actual!r}; expected to include {expected!r}",
                    help=HEADERS_HELP,
                )
            )
        else:
            results.append(
                CheckResult(MODULE, header, "pass", f"{header}: {actual}")
            )

    csp = resp.header("content-security-policy")
    looks_like_dev_port = ctx.base_url.rstrip("/").endswith(":3001")
    if csp:
        results.append(
            CheckResult(
                MODULE,
                "content-security-policy",
                "pass",
                f"CSP present ({len(csp)} chars)",
            )
        )
    elif looks_like_dev_port:
        results.append(
            CheckResult(
                MODULE,
                "content-security-policy",
                "skip",
                "CSP omitted on DEV API (:3001) by design; assert on PROD",
                help=CSP_DEV_SKIP_HELP,
            )
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "content-security-policy",
                "fail",
                "CSP missing on non-DEV target (expected in NODE_ENV=production)",
                help=(
                    *HEADERS_HELP,
                    "Confirm the process was started with NODE_ENV=production.",
                ),
            )
        )

    return results
