"""HTTP protocol adaptation; business behavior lives in application use cases."""

import asyncio
import json
from collections.abc import Awaitable, Callable

from fastapi import Depends, FastAPI, Request
from fastapi.responses import StreamingResponse

from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo


def _not_found(code: str, message: str) -> RuntimeErrorInfo:
    return RuntimeErrorInfo(code, message)


def register_event_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    @app.get("/internal/v1/events", dependencies=[Depends(authenticate)])
    async def event_stream(request: Request, after: int = 0):
        queue = await service.events.subscribe(after=max(0, after))

        async def stream_events():
            try:
                while not await request.is_disconnected():
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=15)
                        event_json = json.dumps(event.as_dict(), ensure_ascii=False)
                        yield f"id: {event.seq}\nevent: {event.type}\ndata: {event_json}\n\n"
                    except TimeoutError:
                        yield ": keep-alive\n\n"
            finally:
                service.events.unsubscribe(queue)

        return StreamingResponse(stream_events(), media_type="text/event-stream")
