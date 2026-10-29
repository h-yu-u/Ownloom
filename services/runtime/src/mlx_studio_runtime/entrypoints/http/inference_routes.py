"""Scoped local provider endpoints; no ordinary Chat conversation is created."""

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse

from mlx_studio_runtime.composition_root import RuntimeApplication
from mlx_studio_runtime.domain.errors import RuntimeFault
from mlx_studio_runtime.domain.worker_protocol import STREAM_QUEUE_SIZE
from mlx_studio_runtime.entrypoints.http.inference_contracts import InferenceRequest
from mlx_studio_runtime.entrypoints.http.provider_stream import (
    ownloom_metadata,
    provider_error,
    stream_result,
    usage,
)


def register_inference_routes(
    app: FastAPI, service: RuntimeApplication, authenticate: Callable[..., Awaitable[None]]
) -> None:
    async def inference_auth(
        request: Request, authorization: str | None = Header(default=None)
    ) -> None:
        scoped = service.capability_grants.authorized(authorization)
        request.state.capability_scoped = scoped
        if not scoped and not service.coding.authorized(authorization):
            await authenticate(authorization)

    @app.get("/internal/v1/inference/models", dependencies=[Depends(inference_auth)])
    async def models() -> dict[str, object]:
        return {
            "object": "list",
            "data": [
                {"id": model.id, "object": "model"}
                for model in service.catalog.models.values()
                if model.task != "image-generation"
            ],
        }

    @app.post("/internal/v1/inference/chat/completions", dependencies=[Depends(inference_auth)])
    async def complete(body: InferenceRequest, request: Request) -> Any:
        payload = body.model_dump(exclude_none=True)
        for message in payload["messages"]:
            if isinstance(message.get("content"), list):
                message["content"] = "\n".join(block["text"] for block in message["content"])
        authorization = request.headers.get("authorization")
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(STREAM_QUEUE_SIZE)
        admitted = asyncio.Event()

        async def on_event(event: dict[str, Any]) -> None:
            if event["type"] == "generation.admitted":
                admitted.set()
            elif body.stream:
                await queue.put(event)

        task = asyncio.create_task(
            service.capability_grants.complete(authorization, payload, on_event)
            if authorization and request.state.capability_scoped
            else service.provider_inference.complete(payload, on_event)
        )
        admission = asyncio.create_task(admitted.wait())
        try:
            while not task.done() and not (body.stream and admitted.is_set()):
                await asyncio.wait(
                    {task, admission} if not admission.done() else {task},
                    timeout=0.1,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if await request.is_disconnected():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                    return {}
            if task.done():
                result = await task
            elif body.stream:
                identity = {
                    "id": f"chatcmpl-{uuid.uuid4().hex}",
                    "created": int(time.time()),
                    "model": body.model,
                }
                return StreamingResponse(
                    stream_result(task, queue, identity), media_type="text/event-stream"
                )
            else:
                result = await task
        except RuntimeFault as error:
            return JSONResponse(status_code=400, content=provider_error(error))
        except asyncio.CancelledError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise
        finally:
            admission.cancel()
            await asyncio.gather(admission, return_exceptions=True)
        if body.tool_choice == "none" and result["message"].get("tool_calls"):
            from fastapi import HTTPException

            raise HTTPException(400, "TOOL_CHOICE_VIOLATION")
        identity = {
            "id": f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": body.model,
        }
        if not body.stream:
            return {
                **identity,
                "choices": [
                    {
                        "index": 0,
                        "message": result["message"],
                        "finish_reason": result["finish_reason"],
                    }
                ],
                "usage": usage(result),
                **ownloom_metadata(result),
            }
        return StreamingResponse(
            stream_result(task, queue, identity), media_type="text/event-stream"
        )
