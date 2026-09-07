"""Repo-root static security checks (SECURITY.md re-audit inspired)."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from lib.result import CheckResult, ScanContext

MODULE = "repo_static"

RG_SKIP_HELP = (
    "Install ripgrep (`rg`) to enable static greps (Ubuntu: `sudo apt install ripgrep`).",
    "Checklist inspiration: SECURITY.md “Re-audit checklist”.",
    "Docs: security/scan/README.md",
)

STATIC_FAIL_HELP = (
    "These greps mirror SECURITY.md re-audit expectations (parseRouteId, no shell exec, SSRF helper, ILIKE).",
    "Prefer ilikeEscaped (src/lib/ilike.ts), parseRouteId for route IDs, execFile over exec, assertUrlAllowed for outbound fetch.",
    "Docs: SECURITY.md · security/scan/README.md",
)


def _git_tracked(repo: Path, rel: str) -> bool:
    try:
        proc = subprocess.run(
            ["git", "ls-files", "--error-unmatch", rel],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
        )
        return proc.returncode == 0
    except FileNotFoundError:
        return False


def _rg(repo: Path, pattern: str, glob: str | None = None) -> tuple[str, list[str]]:
    """Returns (status, lines) where status is ok|missing|error."""
    cmd = ["rg", "-n", "--no-heading", pattern]
    if glob:
        cmd.extend(["--glob", glob])
    cmd.append(str(repo / "src"))
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return "missing", []
    if proc.returncode not in (0, 1):
        return "error", [proc.stderr.strip() or f"exit {proc.returncode}"]
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    return "ok", lines


def run(ctx: ScanContext, _client=None) -> list[CheckResult]:
    results: list[CheckResult] = []
    if not ctx.repo_root:
        return [
            CheckResult(
                MODULE,
                "repo root",
                "skip",
                "Not running from a TaskMesh repo root (package.json name=taskmesh not found)",
            )
        ]

    repo = Path(ctx.repo_root)

    if _git_tracked(repo, ".env"):
        results.append(
            CheckResult(
                MODULE,
                ".env not tracked",
                "fail",
                ".env is tracked by git — secrets risk",
                help=(
                    "Remove `.env` from the index (`git rm --cached .env`) and keep it in .gitignore.",
                    "Docs: SECURITY.md “Secrets and host hardening” · INSTALL.md",
                ),
            )
        )
    else:
        results.append(
            CheckResult(MODULE, ".env not tracked", "pass", ".env is not in git index")
        )

    status, number_params = _rg(repo, r"Number\(req\.params", glob="**/routes/**/*.ts")
    if status == "missing":
        results.append(
            CheckResult(MODULE, "parseRouteId preference", "skip", "rg not installed", help=RG_SKIP_HELP)
        )
    elif status == "error":
        results.append(
            CheckResult(
                MODULE,
                "parseRouteId preference",
                "skip",
                f"rg error: {number_params[0] if number_params else 'unknown'}",
            )
        )
    elif number_params:
        results.append(
            CheckResult(
                MODULE,
                "parseRouteId preference",
                "fail",
                f"Found Number(req.params) under routes ({len(number_params)}): {number_params[0][:120]}",
                help=STATIC_FAIL_HELP,
            )
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "parseRouteId preference",
                "pass",
                "No Number(req.params) under src/routes",
            )
        )

    # child_process.exec / execSync (not RegExp.exec, not execFile)
    status, cp_files = _rg(repo, r"from ['\"]child_process['\"]|require\(['\"]child_process['\"]\)", glob="**/*.{ts,js}")
    if status == "missing":
        results.append(CheckResult(MODULE, "no shell exec()", "skip", "rg not installed", help=RG_SKIP_HELP))
    elif status == "error":
        results.append(
            CheckResult(
                MODULE,
                "no shell exec()",
                "skip",
                f"rg error: {cp_files[0] if cp_files else 'unknown'}",
            )
        )
    else:
        real: list[str] = []
        seen_files: set[str] = set()
        for h in cp_files:
            path = h.split(":", 1)[0]
            if path in seen_files:
                continue
            seen_files.add(path)
            if ".test." in path.replace("\\", "/"):
                continue
            try:
                text = Path(path).read_text(encoding="utf-8")
            except OSError:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if re.search(r"\bexecFile\b", line):
                    continue
                if re.search(r"\bexecSync\s*\(", line) or re.search(
                    r"(?<![\w.])exec\s*\(", line
                ):
                    real.append(f"{path}:{i}:{line.strip()}")
        if real:
            results.append(
                CheckResult(
                    MODULE,
                    "no shell exec()",
                    "fail",
                    f"Possible child_process.exec/execSync ({len(real)}): {real[0][:140]}",
                    help=STATIC_FAIL_HELP,
                )
            )
        else:
            results.append(
                CheckResult(
                    MODULE,
                    "no shell exec()",
                    "pass",
                    "No child_process.exec/execSync in non-test src (execFile OK)",
                )
            )

    status, allow_hits = _rg(repo, r"assertUrlAllowed")
    if status == "missing":
        results.append(
            CheckResult(MODULE, "SSRF helper present", "skip", "rg not installed", help=RG_SKIP_HELP)
        )
    elif status == "error":
        results.append(
            CheckResult(
                MODULE,
                "SSRF helper present",
                "skip",
                f"rg error: {allow_hits[0] if allow_hits else 'unknown'}",
            )
        )
    elif allow_hits:
        results.append(
            CheckResult(
                MODULE,
                "SSRF helper present",
                "pass",
                f"assertUrlAllowed referenced ({len(allow_hits)} hits)",
            )
        )
    else:
        results.append(
            CheckResult(
                MODULE,
                "SSRF helper present",
                "fail",
                "assertUrlAllowed not found under src (assistant SSRF guard)",
                help=STATIC_FAIL_HELP,
            )
        )

    status, raw_ilike = _rg(repo, r"ILIKE[^\n]*\$\{|ilike\([^\n]*\$\{")
    if status == "missing":
        results.append(CheckResult(MODULE, "ILIKE binding", "skip", "rg not installed", help=RG_SKIP_HELP))
    elif status == "error":
        results.append(
            CheckResult(
                MODULE,
                "ILIKE binding",
                "skip",
                f"rg error: {raw_ilike[0] if raw_ilike else 'unknown'}",
            )
        )
    else:
        # Allow the shared helper that binds parameters + ESCAPE.
        unsafe = [
            h
            for h in raw_ilike
            if "/lib/ilike.ts" not in h.replace("\\", "/")
            and "ilikeEscaped" not in h
            and "ESCAPE" not in h
        ]
        if unsafe:
            results.append(
                CheckResult(
                    MODULE,
                    "ILIKE binding",
                    "fail",
                    f"Possible unsafe ILIKE interpolation ({len(unsafe)}): {unsafe[0][:140]}",
                    help=STATIC_FAIL_HELP,
                )
            )
        else:
            results.append(
                CheckResult(
                    MODULE,
                    "ILIKE binding",
                    "pass",
                    "No unsafe ILIKE interpolation outside ilikeEscaped helper",
                )
            )

    return results
