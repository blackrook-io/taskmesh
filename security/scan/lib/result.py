"""Check result types shared by all modules."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Sequence

Status = Literal["pass", "fail", "skip"]


@dataclass
class CheckResult:
    module: str
    name: str
    status: Status
    message: str
    # Remediation / docs shown on FAIL (and optionally SKIP). Bundled by each check.
    help: Sequence[str] = field(default_factory=tuple)


@dataclass
class ScanContext:
    """Runtime options and shared state for one scan run."""

    base_url: str
    repo_root: str | None
    env_file: str | None
    prompt_creds: bool
    skip_http: bool
    skip_repo: bool
    skip_db: bool
    write_html: bool
    email: str | None = None
    password: str | None = None
    api_key: str | None = None
    database_url: str | None = None
    session_cookie: str | None = None
    extras: dict = field(default_factory=dict)

    def api(self, path: str) -> str:
        base = self.base_url.rstrip("/")
        if not path.startswith("/"):
            path = "/" + path
        return f"{base}{path}"
