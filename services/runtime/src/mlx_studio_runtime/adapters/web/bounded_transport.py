"""Keep SDK responses bounded without replacing its Search/Extract implementation."""

import httpx


class BoundedTransport(httpx.AsyncBaseTransport):
    def __init__(self, upstream: httpx.AsyncBaseTransport | None = None) -> None:
        self.upstream = upstream or httpx.AsyncHTTPTransport(trust_env=False)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self.upstream.handle_async_request(request)
        try:
            buffer = bytearray()
            async for chunk in response.aiter_bytes():
                if len(buffer) + len(chunk) > 2 * 1024 * 1024:
                    raise ValueError("WEB_RESPONSE_TOO_LARGE")
                buffer.extend(chunk)
            headers = response.headers.copy()
            # aiter_bytes has already decoded the content encoding.
            headers.pop("content-encoding", None)
            headers.pop("content-length", None)
            return httpx.Response(response.status_code, headers=headers, content=bytes(buffer))
        finally:
            await response.aclose()

    async def aclose(self) -> None:
        await self.upstream.aclose()
