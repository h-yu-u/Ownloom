"""Strict policy for result URLs sent to the hosted Extract service."""

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

from mlx_studio_runtime.domain.web import public_result_url


class PublicResultPolicy:
    async def allowed(self, url: str) -> bool:
        normalized = public_result_url(url)
        if not normalized:
            return False
        try:
            parsed = urlsplit(normalized)
            addresses = await asyncio.get_running_loop().getaddrinfo(
                parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM
            )
            return bool(addresses) and all(
                ipaddress.ip_address(item[4][0]).is_global for item in addresses
            )
        except (ValueError, OSError):
            return False
