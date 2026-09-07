"""npm audit (production dependencies) when run from repo root."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from lib.result import CheckResult, ScanContext

MODULE = "repo_npm_audit"

# Shared docs / remediation shown whenever this check fails or needs operator action.
DOCS = (
    "Check purpose: production deps must not have npm high/critical advisories (`npm audit --omit=dev`).",
    "Full report: run `npm audit --omit=dev` from the repo root (human-readable) or add `--json`.",
    "Safe-ish auto-fix for non-breaking patches: `npm audit fix` (review the diff; re-run tests).",
    "Avoid `npm audit fix --force` unless you intentionally accept breaking upgrades (e.g. drizzle major).",
    "TaskMesh docs: SECURITY.md (threat model / residual T0086 CI) and security/scan/README.md.",
    "CI follow-up: T0086 should gate on this module; remediating advisories may be a separate Task.",
)

# Package-specific operator notes when npm has no easy fix or upgrades are breaking.
KNOWN_PACKAGE_NOTES: dict[str, tuple[str, ...]] = {
    "drizzle-orm": (
        "drizzle-orm: advisory is typically SQL identifier escaping (GHSA-gpj5-g38j-94v9).",
        "Upgrade path often requires `npm audit fix --force` → drizzle-orm ≥0.45.x (breaking); plan a migration Task.",
        "Advisory: https://github.com/advisories/GHSA-gpj5-g38j-94v9",
    ),
    "xlsx": (
        "xlsx (SheetJS): high severity (prototype pollution / ReDoS); npm often reports no fix available.",
        "Options: replace the import/export library, vendor a patched build, or document accepted risk until replaced.",
        "Advisories: https://github.com/advisories/GHSA-4r6h-8v6p-xvw6 and https://github.com/advisories/GHSA-5pgg-2g8v-p4x9",
    ),
}


def _via_lines(vinfo: dict[str, Any]) -> list[str]:
    """Extract advisory titles/URLs from npm audit `via` entries."""
    lines: list[str] = []
    via = vinfo.get("via") or []
    if not isinstance(via, list):
        return lines
    for item in via:
        if isinstance(item, str):
            lines.append(f"via dependency: {item}")
            continue
        if not isinstance(item, dict):
            continue
        title = item.get("title") or item.get("name") or "advisory"
        url = item.get("url") or ""
        sev = item.get("severity") or ""
        range_ = item.get("range") or ""
        bit = f"{title}"
        if sev:
            bit += f" [{sev}]"
        if range_:
            bit += f" (range {range_})"
        if url:
            bit += f" — {url}"
        lines.append(bit)
    return lines


def _format_fix_available(fix: Any) -> str:
    if fix is True:
        return "yes"
    if fix is False or fix is None:
        return "no"
    if isinstance(fix, dict):
        name = fix.get("name") or "?"
        ver = fix.get("version") or "?"
        major = fix.get("isSemVerMajor")
        major_note = " (semver major / breaking)" if major else ""
        return f"yes → {name}@{ver}{major_note}"
    return str(fix)


def _package_help(name: str, vinfo: dict[str, Any]) -> list[str]:
    sev = str(vinfo.get("severity", "")).lower()
    fix = vinfo.get("fixAvailable")
    is_direct = vinfo.get("isDirect")
    range_ = vinfo.get("range") or ""
    lines = [
        f"Package `{name}` severity={sev or '?'} "
        f"fixAvailable={_format_fix_available(fix)} isDirect={is_direct} range={range_ or 'n/a'}."
    ]
    lines.extend(_via_lines(vinfo))
    notes = KNOWN_PACKAGE_NOTES.get(name)
    if notes:
        lines.extend(notes)
    elif fix is False:
        lines.append(
            f"No automated fix reported for `{name}` — evaluate replace/vendor/accept-risk explicitly."
        )
    elif fix is True or isinstance(fix, dict):
        lines.append(
            f"Fix available for `{name}` — try `npm audit fix` first; use `--force` only after review."
        )
    return lines


def run(ctx: ScanContext, _client=None) -> list[CheckResult]:
    if not ctx.repo_root:
        return [
            CheckResult(
                MODULE,
                "npm audit",
                "skip",
                "Not running from TaskMesh repo root",
                help=(
                    "Run from the TaskMesh repository root so package.json / lockfile are visible.",
                    *DOCS[:2],
                ),
            )
        ]

    repo = Path(ctx.repo_root)
    try:
        proc = subprocess.run(
            ["npm", "audit", "--omit=dev", "--json"],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return [
            CheckResult(
                MODULE,
                "npm audit",
                "skip",
                "npm not found on PATH",
                help=(
                    "Install Node.js/npm (see INSTALL.md) so `npm audit --omit=dev` can run.",
                    *DOCS[:2],
                ),
            )
        ]

    # npm audit exits non-zero when vulnerabilities exist; still parse JSON.
    raw = proc.stdout.strip() or proc.stderr.strip()
    if not raw:
        return [
            CheckResult(
                MODULE,
                "npm audit",
                "fail",
                f"npm audit produced no output (exit {proc.returncode})",
                help=DOCS,
            )
        ]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return [
            CheckResult(
                MODULE,
                "npm audit",
                "fail",
                f"Could not parse npm audit JSON (exit {proc.returncode})",
                help=(
                    "Re-run `npm audit --omit=dev` manually; if JSON is empty, check npm version ≥7.",
                    *DOCS,
                ),
            )
        ]

    # npm v7+ metadata.vulnerabilities counts
    meta = data.get("metadata", {}).get("vulnerabilities", {})
    critical = int(meta.get("critical", 0) or 0)
    high = int(meta.get("high", 0) or 0)
    moderate = int(meta.get("moderate", 0) or 0)
    low = int(meta.get("low", 0) or 0)
    info_n = int(meta.get("info", 0) or 0)
    summary = (
        f"critical={critical} high={high} moderate={moderate} low={low} info={info_n}"
    )

    vulns = data.get("vulnerabilities") or {}
    offenders: list[str] = []
    help_lines: list[str] = list(DOCS)
    if isinstance(vulns, dict):
        for name, vinfo in sorted(vulns.items()):
            if not isinstance(vinfo, dict):
                continue
            sev = str(vinfo.get("severity", "")).lower()
            if sev not in ("high", "critical"):
                continue
            offenders.append(f"{name}({sev})")
            help_lines.append(f"—— {name} ——")
            help_lines.extend(_package_help(name, vinfo))

    detail = summary
    if offenders:
        detail = f"{summary}; packages: {', '.join(offenders[:12])}"

    if critical or high:
        help_lines.append(
            "Findings are reported here; `npm run security:scan` still exits 0 by default. "
            "For CI to fail the job on findings: add `--fail-on-findings`. "
            "HTTP/DB-only: `--skip-repo` or omit module `repo_npm_audit`."
        )
        return [
            CheckResult(
                MODULE,
                "npm audit high/critical",
                "fail",
                f"Production dependency audit found high/critical issues ({detail})",
                help=tuple(help_lines),
            )
        ]

    return [
        CheckResult(
            MODULE,
            "npm audit high/critical",
            "pass",
            f"No high/critical production vulns ({summary})",
        )
    ]
