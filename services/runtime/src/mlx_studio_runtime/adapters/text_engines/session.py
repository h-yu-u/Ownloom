"""Concrete text/VLM engine loading, streaming and cleanup inside the Worker."""

import logging
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import redirect_stdout
from typing import Any, cast

from mlx_studio_runtime.adapters.text_engines.coding_cache import CodingPrefixCache
from mlx_studio_runtime.adapters.text_engines.drafts import DraftAcceleration
from mlx_studio_runtime.adapters.text_engines.generation_stats import native_generation_stats
from mlx_studio_runtime.adapters.text_engines.mtp import MtpDraft
from mlx_studio_runtime.adapters.text_engines.prefix_cache import ChatPrefixCache
from mlx_studio_runtime.adapters.worker_runtime.context import WorkerContext
from mlx_studio_runtime.domain.generation_stats import GenerationStats


class EngineSession:
    def __init__(
        self,
        emit: Callable[[str, dict[str, Any]], None] | None = None,
        context: WorkerContext | None = None,
    ) -> None:
        self.event_sink = context.emit if context else emit
        self.context = context or WorkerContext(self.emit)
        self.cancel, self.shutdown = self.context.signals
        self.model_id: str | None = None
        self.model: Any = None
        self.tokenizer: Any = None
        self.processor: Any = None
        self.model_config: Any = None
        self.engine = "fake"
        self.finish_reason = "stop"
        self.generation_tokens = 0
        self.generation_stats: GenerationStats | None = None
        self.context_limit = 8192
        self.prefix_cache = ChatPrefixCache()
        self.coding_cache = CodingPrefixCache()
        self.mtp = MtpDraft()
        self.drafts = DraftAcceleration(self.mtp)

    def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        if self.event_sink is None:
            raise NotImplementedError
        self.event_sink(event_type, payload)

    def load(self, payload: dict[str, Any]) -> None:
        self.unload()
        manifest_value = payload.get("manifest", {})
        if not isinstance(manifest_value, dict):
            raise ValueError("manifest must be an object")
        manifest = cast(dict[str, object], manifest_value)
        self.model_id = str(manifest.get("id", ""))
        self.engine = str(manifest.get("engine", "fake"))
        context_limit = manifest.get("contextLength")
        self.context_limit = context_limit if isinstance(context_limit, int) else 8192
        if self.engine == "mlx-lm":
            from mlx_lm import load  # type: ignore[import-not-found]

            with redirect_stdout(sys.stderr):
                loaded = load(
                    str(manifest["localPath"]),
                    tokenizer_config={"trust_remote_code": False},
                )
                self.model, self.tokenizer = loaded[0], loaded[1]
        elif self.engine == "mlx-vlm":
            from mlx_vlm import load  # type: ignore[import-not-found]
            from mlx_vlm.utils import load_config  # type: ignore[import-not-found]

            from mlx_studio_runtime.adapters.text_engines.streaming_decoder import (
                configure_streaming_decoder,
            )

            model_path = str(manifest["localPath"])
            with redirect_stdout(sys.stderr):
                self.model, self.processor = load(model_path, trust_remote_code=False)
                configure_streaming_decoder(self.processor)
                self.model_config = load_config(model_path)
        elif self.engine != "fake":
            raise RuntimeError(f"engine is not available in this Worker: {self.engine}")
        with redirect_stdout(sys.stderr):
            self.drafts.load(manifest, self.model)

    def generate(self, payload: dict[str, Any]) -> None:
        self.coding_cache.clear()
        if self.model_id is None:
            raise RuntimeError("MODEL_NOT_LOADED")
        job_id = str(payload["job_id"])
        prompt = str(payload.get("prompt", ""))
        requested = payload.get("max_tokens")
        max_tokens = max(1, int(requested)) if requested is not None else None
        temperature = max(0.0, min(float(payload.get("temperature", 0.7)), 2.0))
        self.finish_reason = "stop"
        self.generation_tokens = 0
        self.generation_stats = None
        completed = False
        self.prefix_cache.begin(self.model, self.engine, payload)
        try:
            self.emit("generation.started", {"job_id": job_id})
            completed = self._stream_chat(
                payload, self._chunks(payload, prompt, max_tokens, temperature)
            )
        except Exception as error:
            if self.cancel.is_set() or self.shutdown.is_set():
                self.emit("generation.cancelled", {"job_id": job_id})
                return
            self.emit(
                "generation.failed",
                {
                    "job_id": job_id,
                    "error_code": "CONTEXT_BUDGET_EXCEEDED"
                    if str(error) == "CONTEXT_BUDGET_EXCEEDED"
                    else "INFERENCE_FAILED",
                    "message": "模型推理失败",
                },
            )
        finally:
            self.prefix_cache.finish(
                completed and not self.cancel.is_set() and not self.shutdown.is_set()
            )

    def _stream_chat(self, payload: dict[str, Any], chunks: Iterator[str]) -> bool:
        job_id = str(payload["job_id"])
        had_stats = False
        try:
            for chunk in chunks:
                if self.cancel.is_set() or self.shutdown.is_set():
                    self.emit("generation.cancelled", {"job_id": job_id})
                    return False
                stats = self._chat_stats_payload(include_unknown=had_stats)
                if chunk or stats:
                    self.emit("generation.delta", {"job_id": job_id, "text": chunk, **stats})
                had_stats = self.generation_stats is not None
                if self.engine == "fake":
                    time.sleep(0.015)
        finally:
            close = getattr(chunks, "close", None)
            if callable(close):
                close()
        terminal = "cancelled" if self.cancel.is_set() or self.shutdown.is_set() else "completed"
        self.emit(
            f"generation.{terminal}",
            {
                "job_id": job_id,
                "finish_reason": self.finish_reason,
                "generation_tokens": self.generation_tokens,
                **self._chat_stats_payload(),
            },
        )
        return terminal == "completed"

    def _chunks(
        self,
        payload: dict[str, Any],
        prompt: str,
        max_tokens: int | None,
        temperature: float,
    ) -> Iterator[str]:
        if self.engine == "mlx-lm":
            return self._mlx_chunks(prompt, max_tokens, temperature, payload.get("messages", []))
        if self.engine == "mlx-vlm":
            return self._vlm_chunks(
                prompt,
                max_tokens,
                temperature,
                payload.get("image_paths", []),
                payload.get("messages", []),
            )
        return self._fake_chunks(prompt)

    def _mlx_chunks(
        self,
        prompt: str,
        max_tokens: int | None,
        temperature: float,
        messages: object,
    ) -> Iterator[str]:
        from mlx_lm import stream_generate  # type: ignore[import-not-found]
        from mlx_lm.sample_utils import make_sampler  # type: ignore[import-not-found]

        rendered = self.tokenizer.apply_chat_template(
            normalize_messages(messages, prompt),
            tokenize=False,
            add_generation_prompt=True,
        )
        max_tokens = self._check_budget(self.tokenizer, rendered, max_tokens)
        sampler = make_sampler(temp=temperature)
        for response in stream_generate(
            self.model,
            self.tokenizer,
            rendered,
            max_tokens=max_tokens,
            sampler=sampler,
        ):
            self.record_chat_completion(response)
            if self.cancel.is_set():
                return
            yield response.text

    def _vlm_chunks(
        self,
        prompt: str,
        max_tokens: int | None,
        temperature: float,
        image_paths: object,
        messages: object = None,
    ) -> Iterator[str]:
        if not isinstance(image_paths, list) or len(image_paths) > 4:
            raise ValueError("zero to four image paths are supported")
        from mlx_vlm import stream_generate  # type: ignore[import-not-found]

        paths = [str(path) for path in image_paths]
        formatted = self._vlm_prompt(prompt, paths, messages)
        max_tokens = self._check_budget(
            self.processor.tokenizer, formatted, max_tokens, len(paths) * 2048
        )
        # DFlash needs prefill features for its full local window. Until those
        # snapshots accompany APC, this explicit mode uses a cold target prefix.
        if self.drafts.select(has_images=bool(paths)) == "dflash2":
            self.prefix_cache.clear()
        with self.drafts.request(
            self.model, temperature=temperature, has_images=bool(paths)
        ) as draft:
            responses = stream_generate(
                model=self.model,
                processor=self.processor,
                prompt=formatted,
                image=paths,
                max_tokens=max_tokens,
                temperature=temperature,
                verbose=False,
                **self.prefix_cache.options,
                **draft,
            )
            try:
                for response in responses:
                    self.record_chat_completion(response)
                    if self.cancel.is_set() or self.shutdown.is_set():
                        return
                    text = response if isinstance(response, str) else getattr(response, "text", "")
                    yield str(text) if text else ""
            finally:
                close = getattr(responses, "close", None)
                if callable(close):
                    close()

    def _vlm_prompt(self, prompt: str, paths: list[str], messages: object) -> str:
        from mlx_vlm.prompt_utils import apply_chat_template  # type: ignore[import-not-found]

        normalized = normalize_messages(messages, prompt)
        if paths and len(normalized) > 1:
            background = "\n".join(f"{item['role']}: {item['content']}" for item in normalized[:-1])
            normalized = [
                {
                    "role": "user",
                    "content": "<文字背景>\n"
                    + background
                    + "\n</文字背景>\n"
                    + normalized[-1]["content"],
                }
            ]
        formatted = apply_chat_template(
            self.processor,
            self.model_config,
            normalized,
            num_images=len(paths),
            add_generation_prompt=True,
            enable_thinking=False,
        )
        if not isinstance(formatted, str):
            raise ValueError("Chat template did not produce a text prompt")
        self._cache_boundary(normalized, formatted)
        return formatted

    def _cache_boundary(self, messages: list[dict[str, str]], formatted: str) -> None:
        suffix = self.prefix_cache.suffix
        if not self.prefix_cache.options or not suffix:
            return
        try:
            from mlx_vlm.prompt_utils import apply_chat_template  # type: ignore[import-not-found]

            if not messages[-1]["content"].endswith(suffix):
                self.prefix_cache.clear()
                return
            stable = [
                *messages[:-1],
                {**messages[-1], "content": messages[-1]["content"][: -len(suffix)]},
            ]
            rendered = apply_chat_template(
                self.processor,
                self.model_config,
                stable,
                num_images=0,
                add_generation_prompt=True,
                enable_thinking=False,
            )
            self.prefix_cache.guard_suffix(
                self.processor.tokenizer.encode(formatted),
                self.processor.tokenizer.encode(rendered),
            )
        except Exception as error:
            logging.getLogger(__name__).warning(
                "Chat cache boundary unavailable: %s", type(error).__name__
            )
            self.prefix_cache.clear()

    def record_chat_completion(self, response: object) -> None:
        self.record_completion(response)
        self.generation_stats = native_generation_stats(self.engine, response)

    def _chat_stats_payload(self, include_unknown: bool = False) -> dict[str, object]:
        if self.generation_stats is not None or include_unknown:
            return {"generationStats": self.generation_stats}
        return {}

    def record_completion(self, response: Any) -> None:
        reason = getattr(response, "finish_reason", None)
        if reason in {"stop", "length"}:
            self.finish_reason = reason
        tokens = getattr(response, "generation_tokens", None)
        if isinstance(tokens, int):
            self.generation_tokens = tokens

    def _check_budget(
        self, tokenizer: Any, prompt: str, reserve: int | None, visual_tokens: int = 0
    ) -> int:
        available = self.context_limit - len(tokenizer.encode(prompt)) - visual_tokens - 128
        if available < 1 or (reserve is not None and reserve > available):
            raise ValueError("CONTEXT_BUDGET_EXCEEDED")
        return available if reserve is None else reserve

    @staticmethod
    def _fake_chunks(prompt: str) -> Iterator[str]:
        reply = (
            f"FakeEngine received: {prompt.strip()}\n"
            "This response is streamed for UI and protocol development."
        )
        for start in range(0, len(reply), 5):
            yield reply[start : start + 5]

    def unload(self) -> None:
        self.prefix_cache.clear()
        self.coding_cache.clear()
        self.drafts.clear()
        self.model = None
        self.tokenizer = None
        self.processor = None
        self.model_config = None
        self.model_id = None
        self.engine = "fake"
        self.generation_stats = None


def normalize_messages(messages: object, prompt: str) -> list[dict[str, str]]:
    if not isinstance(messages, list):
        return [{"role": "user", "content": prompt}]
    normalized: list[dict[str, str]] = []
    for value in messages:
        if not isinstance(value, dict):
            raise ValueError("MESSAGE_STRUCTURE_UNSUPPORTED")
        message = cast(dict[str, object], value)
        role = message.get("role")
        content = message.get("content")
        if (
            not isinstance(role, str)
            or role
            not in {
                "user",
                "assistant",
                "system",
            }
            or not isinstance(content, str)
        ):
            raise ValueError("MESSAGE_STRUCTURE_UNSUPPORTED")
        normalized.append({"role": role, "content": content})
    return normalized or [{"role": "user", "content": prompt}]
