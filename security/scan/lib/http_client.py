"""Minimal HTTP client (stdlib) with cookie jar for session auth."""

from __future__ import annotations

import json
import http.client
import ssl
from typing import Any
from urllib.parse import urlparse



class HttpResponse:
    def __init__(
        self,
        status: int,
        headers: dict[str, str],
        body: bytes,
        url: str,
        raw_headers: list[tuple[str, str]] | None = None,
    ) -> None:
        self.status = status
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.body = body
        self.url = url
        self.raw_headers = raw_headers or []

    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.text() or "null")

    def header(self, name: str) -> str | None:
        return self.headers.get(name.lower())

    def set_cookie_headers(self) -> list[str]:
        return [v for k, v in self.raw_headers if k.lower() == "set-cookie"]


class HttpClient:
    """HTTP helper that preserves Set-Cookie even when Secure is set on http:// loopback."""

    def __init__(self, base_url: str, timeout: float = 15.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._cookies: dict[str, str] = {}
        parsed = urlparse(self.base_url)
        self._scheme = parsed.scheme or "http"
        self._host = parsed.hostname or "127.0.0.1"
        self._port = parsed.port or (443 if self._scheme == "https" else 80)

    def url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        if not path.startswith("/"):
            path = "/" + path
        return f"{self.base_url}{path}"

    def _ingest_set_cookie(self, set_cookie_values: list[str]) -> None:
        for raw in set_cookie_values:
            # name=value; Attr=...
            first = raw.split(";", 1)[0].strip()
            if "=" not in first:
                continue
            name, _, value = first.partition("=")
            name = name.strip()
            value = value.strip()
            if name in ("taskmesh_session", "taskmesh_session_dev") or name.startswith("taskmesh_"):
                self._cookies[name] = value

    def request(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        json_body: Any = None,
        data: bytes | None = None,
    ) -> HttpResponse:
        full = self.url(path)
        parsed = urlparse(full)
        hdrs = {"Accept": "application/json", "Host": parsed.netloc, **(headers or {})}
        if self._cookies:
            hdrs["Cookie"] = "; ".join(f"{k}={v}" for k, v in self._cookies.items())

        body = data
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")

        if parsed.scheme == "https":
            conn: http.client.HTTPConnection = http.client.HTTPSConnection(
                parsed.hostname,
                parsed.port or 443,
                timeout=self.timeout,
                context=ssl.create_default_context(),
            )
        else:
            conn = http.client.HTTPConnection(
                parsed.hostname,
                parsed.port or 80,
                timeout=self.timeout,
            )

        try:
            conn.request(method.upper(), parsed.path + (f"?{parsed.query}" if parsed.query else ""), body=body, headers=hdrs)
            resp = conn.getresponse()
            raw = resp.read()
            raw_headers = resp.getheaders()
            out = HttpResponse(
                status=resp.status,
                headers={k: v for k, v in raw_headers},
                body=raw,
                url=full,
                raw_headers=list(raw_headers),
            )
            self._ingest_set_cookie(out.set_cookie_headers())
            return out
        finally:
            conn.close()

    def get(self, path: str, **kw: Any) -> HttpResponse:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw: Any) -> HttpResponse:
        return self.request("POST", path, **kw)

    def patch(self, path: str, **kw: Any) -> HttpResponse:
        return self.request("PATCH", path, **kw)

    def delete(self, path: str, **kw: Any) -> HttpResponse:
        return self.request("DELETE", path, **kw)

    def session_cookie_value(self) -> str | None:
        for name in ("taskmesh_session", "taskmesh_session_dev"):
            if name in self._cookies:
                return self._cookies[name]
        return next(iter(self._cookies.values()), None)

    def login(self, email: str, password: str) -> HttpResponse:
        return self.post(
            "/api/v1/auth/login",
            json_body={"email": email, "password": password},
            headers={
                "X-TaskMesh-Client": "ui",
                "Origin": self.base_url,
            },
        )

    def clear_cookies(self) -> None:
        self._cookies.clear()
