"""Load credentials and DATABASE_URL from env files / process env / prompt."""

from __future__ import annotations

import getpass
import os
from pathlib import Path

DEFAULT_WORKTASK_ENV = Path.home() / ".config" / "taskmesh" / "worktask.env"


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if key:
            out[key] = val
    return out


def resolve_repo_root(start: Path | None = None) -> Path | None:
    """Walk up from start (or cwd) looking for package.json named taskmesh."""
    cur = (start or Path.cwd()).resolve()
    for candidate in [cur, *cur.parents]:
        pkg = candidate / "package.json"
        if not pkg.is_file():
            continue
        try:
            text = pkg.read_text(encoding="utf-8")
        except OSError:
            continue
        if '"name": "taskmesh"' in text or '"name":"taskmesh"' in text:
            return candidate
    return None


def load_scan_secrets(
    *,
    env_file: str | None,
    prompt_creds: bool,
    repo_root: Path | None,
) -> dict[str, str | None]:
    """
    Merge secrets from (highest precedence last for empty fills):
    process env, repo .env, --env-file / worktask.env, optional prompt.
    """
    merged: dict[str, str] = {}

    # Process environment first as a base.
    for key in (
        "TASKMESH_EMAIL",
        "TASKMESH_PASSWORD",
        "TASKMESH_API_KEY",
        "DATABASE_URL",
    ):
        if os.environ.get(key):
            merged[key] = os.environ[key]

    if repo_root:
        repo_env = _parse_env_file(repo_root / ".env")
        # Prefer DATABASE_URL from .env if not already set; never require password from .env for HTTP.
        if "DATABASE_URL" in repo_env and "DATABASE_URL" not in merged:
            merged["DATABASE_URL"] = repo_env["DATABASE_URL"]

    candidates: list[Path] = []
    if env_file:
        candidates.append(Path(env_file).expanduser())
    else:
        candidates.append(DEFAULT_WORKTASK_ENV)

    loaded_from: Path | None = None
    for path in candidates:
        data = _parse_env_file(path)
        if not data:
            continue
        loaded_from = path
        for key in (
            "TASKMESH_EMAIL",
            "TASKMESH_PASSWORD",
            "TASKMESH_API_KEY",
            "DATABASE_URL",
        ):
            if key in data and data[key]:
                merged[key] = data[key]
        break

    email = merged.get("TASKMESH_EMAIL")
    password = merged.get("TASKMESH_PASSWORD")
    api_key = merged.get("TASKMESH_API_KEY")
    database_url = merged.get("DATABASE_URL")

    if prompt_creds and (not email or not password) and not api_key:
        print("Credentials needed for authenticated HTTP checks.")
        if not email:
            email = input("TASKMESH_EMAIL: ").strip() or None
        if not password and email:
            password = getpass.getpass("TASKMESH_PASSWORD: ") or None

    return {
        "email": email,
        "password": password,
        "api_key": api_key,
        "database_url": database_url,
        "env_file_loaded": str(loaded_from) if loaded_from else None,
    }
