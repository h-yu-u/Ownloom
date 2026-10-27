"""Immutable web configuration and retrieval values."""

import ipaddress
import re
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


@dataclass(frozen=True)
class WebConfig:
    id: str
    revision: int
    provider: str
    base_url: str
    secret_ref: str | None
    timeout_seconds: int = 30
    max_results: int = 6


@dataclass(frozen=True)
class SearchHit:
    title: str
    url: str
    snippet: str
    published_at: str | None = None


@dataclass(frozen=True)
class PageRead:
    url: str
    text: str


def public_result_url(value: str) -> str | None:
    """Validate a public-looking reference without authorizing a network read."""
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").rstrip(".").lower()
        if (
            parsed.scheme not in {"http", "https"}
            or not host
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 80, 443}
            or any(character.isspace() or ord(character) < 32 for character in value)
        ):
            return None
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            labels = host.encode("idna").decode("ascii").split(".")
            if (
                len(labels) < 2
                or labels[-1].isdigit()
                or labels[-1]
                in {"localhost", "local", "internal", "lan", "home", "test", "invalid", "onion"}
                or any(
                    not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                    for label in labels
                )
            ):
                return None
        else:
            if not address.is_global:
                return None
        return urlunsplit(
            (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, parsed.query, "")
        )
    except (ValueError, UnicodeError):
        return None


def normalize_base_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeFault(RuntimeErrorInfo("WEB_CONFIG_INVALID", "请输入有效的搜索服务地址"))
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeFault(RuntimeErrorInfo("WEB_CONFIG_INVALID", "远程搜索服务必须使用 HTTPS"))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))
