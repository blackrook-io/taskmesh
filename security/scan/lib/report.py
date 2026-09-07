"""Console + HTML reporting."""

from __future__ import annotations

import html
from datetime import datetime, timezone
from pathlib import Path

from .result import CheckResult

RESET = "\033[0m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[36m"

STATUS_LABEL = {"pass": "PASS", "fail": "FAIL", "skip": "SKIP"}
STATUS_COLOR = {"pass": GREEN, "fail": RED, "skip": YELLOW}


def print_header(base_url: str, started: datetime) -> None:
    print(f"{BOLD}TaskMesh security scan{RESET}")
    print(f"  Target: {base_url}")
    print(f"  Started: {started.isoformat()}")
    print()


def print_result(r: CheckResult) -> None:
    color = STATUS_COLOR[r.status]
    label = STATUS_LABEL[r.status]
    print(f"  {color}{label}{RESET}  [{r.module}] {r.name}")
    print(f"         {DIM}{r.message}{RESET}")
    # Show bundled help on fail always; on skip when the module provided guidance.
    if r.help and r.status in ("fail", "skip"):
        print(f"         {CYAN}Help:{RESET}")
        for line in r.help:
            print(f"           {CYAN}•{RESET} {line}")


def print_summary(results: list[CheckResult], html_path: Path | None) -> None:
    counts = {k: 0 for k in ("pass", "fail", "skip")}
    for r in results:
        counts[r.status] += 1
    print()
    print(
        f"{BOLD}Summary{RESET}: "
        f"{GREEN}{counts['pass']} pass{RESET}, "
        f"{RED}{counts['fail']} fail{RESET}, "
        f"{YELLOW}{counts['skip']} skip{RESET} "
        f"(total {len(results)})"
    )
    if html_path:
        print(f"HTML log: {html_path}")


def _format_detail_html(r: CheckResult) -> str:
    parts = [f"<div>{html.escape(r.message)}</div>"]
    if r.help and r.status in ("fail", "skip"):
        items = "".join(f"<li>{html.escape(line)}</li>" for line in r.help)
        parts.append(f'<div class="help"><strong>Help</strong><ul>{items}</ul></div>')
    return "".join(parts)


def write_html_log(
    results: list[CheckResult],
    *,
    base_url: str,
    started: datetime,
    out_dir: Path,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = started.strftime("%Y%m%d-%H%M%S")
    path = out_dir / f"scan-{stamp}.html"
    counts = {k: 0 for k in ("pass", "fail", "skip")}
    for r in results:
        counts[r.status] += 1

    rows = []
    for r in results:
        rows.append(
            "<tr class='{st}'><td>{st}</td><td>{mod}</td><td>{name}</td><td>{detail}</td></tr>".format(
                st=html.escape(r.status),
                mod=html.escape(r.module),
                name=html.escape(r.name),
                detail=_format_detail_html(r),
            )
        )

    finished = datetime.now(timezone.utc)
    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>TaskMesh security scan {html.escape(stamp)}</title>
<style>
  body {{ font-family: ui-sans-serif, system-ui, sans-serif; background: #1a1c1e; color: #e8ebe6;
         margin: 2rem; line-height: 1.45; }}
  h1 {{ color: #8fbc8f; }}
  .meta {{ color: #9aa3a0; margin-bottom: 1.5rem; }}
  table {{ border-collapse: collapse; width: 100%; }}
  th, td {{ border: 1px solid #333; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }}
  th {{ background: #25282b; }}
  tr.pass td:first-child {{ color: #6ee7a8; font-weight: 600; }}
  tr.fail td:first-child {{ color: #f87171; font-weight: 600; }}
  tr.skip td:first-child {{ color: #fbbf24; font-weight: 600; }}
  .summary span {{ margin-right: 1rem; }}
  .help {{ margin-top: 0.5rem; color: #9ec9d9; font-size: 0.95em; }}
  .help ul {{ margin: 0.35rem 0 0 1.1rem; padding: 0; }}
  .help li {{ margin: 0.2rem 0; }}
</style>
</head>
<body>
  <h1>TaskMesh defensive security scan</h1>
  <div class="meta">
    <div>Target: {html.escape(base_url)}</div>
    <div>Started (UTC): {html.escape(started.isoformat())}</div>
    <div>Finished (UTC): {html.escape(finished.isoformat())}</div>
    <div class="summary">
      <span>pass: {counts['pass']}</span>
      <span>fail: {counts['fail']}</span>
      <span>skip: {counts['skip']}</span>
      <span>total: {len(results)}</span>
    </div>
  </div>
  <table>
    <thead><tr><th>Status</th><th>Module</th><th>Check</th><th>Detail</th></tr></thead>
    <tbody>
      {"".join(rows)}
    </tbody>
  </table>
  <p class="meta">Defensive audit only — no exploit payloads. See security/scan/README.md.</p>
</body>
</html>
"""
    path.write_text(doc, encoding="utf-8")
    return path
