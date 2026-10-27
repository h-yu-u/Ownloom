"""Pinned mlx-audio 0.5.9 Qwen adapter; local resources and full non-streamed results."""

import json
from collections.abc import Callable, Iterator
from importlib.metadata import version
from pathlib import Path
from typing import Any

from mlx_studio_runtime.adapters.speech_model_scan import scan_speech
from mlx_studio_runtime.domain.speech import LANGUAGES


class Qwen3TtsAdapter:
    def __init__(self, model_path: str) -> None:
        root = Path(model_path)
        config = json.loads((root / "config.json").read_text())
        capabilities = scan_speech(root, config)
        if not capabilities.operations:
            raise ValueError("SPEECH_RESOURCES_INCOMPLETE")
        if version("mlx-audio") != "0.5.9":
            raise ValueError("SPEECH_ADAPTER_VERSION_MISMATCH")
        from mlx_audio.tts.utils import load  # type: ignore[import-not-found]

        self.model: Any = load(root, strict=True)
        self.variant = capabilities.variant
        if self.model.tokenizer is None or self.model.speech_tokenizer is None:
            raise ValueError("SPEECH_RESOURCES_INCOMPLETE")
        if self.variant == "base" and not self.model.speech_tokenizer.has_encoder:
            raise ValueError("SPEECH_CODEC_ENCODER_MISSING")

    def segments(
        self, parameters: dict[str, object], check: Callable[[], None]
    ) -> Iterator[tuple[int, bytes]]:
        import numpy as np

        language = LANGUAGES[str(parameters["language"])]
        kwargs: dict[str, object] = {
            "text": parameters["text"],
            "lang_code": language,
            "stream": False,
            "verbose": False,
            "max_tokens": 4096,
        }
        if parameters["mode"] == "preset" and self.variant == "custom_voice":
            kwargs["voice"] = parameters["speaker"]
        elif parameters["mode"] == "clone" and self.variant == "base":
            kwargs.update(
                ref_audio=parameters["reference_path"], ref_text=parameters["reference_text"]
            )
        else:
            raise ValueError("SPEECH_MODE_UNSUPPORTED")
        for result in self.model.generate(**kwargs):
            check()
            if result.token_count >= 4096:
                raise ValueError("SPEECH_OUTPUT_TRUNCATED")
            if getattr(result, "is_streaming_chunk", False):
                raise ValueError("SPEECH_SEGMENT_PROTOCOL_INVALID")
            samples = np.asarray(result.audio, dtype=np.float32).squeeze()
            if samples.ndim != 1 or not samples.size or not np.isfinite(samples).all():
                raise ValueError("AUDIO_OUTPUT_INVALID")
            yield int(result.sample_rate), (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()

    def close(self) -> None:
        import gc

        import mlx.core as mx  # type: ignore[import-not-found]

        self.model = None
        mx.synchronize()
        gc.collect()
        mx.clear_cache()
