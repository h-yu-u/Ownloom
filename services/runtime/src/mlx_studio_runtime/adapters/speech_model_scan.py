"""Offline Qwen speech resource inspection; does not load model code."""

import json
from dataclasses import replace
from pathlib import Path

from mlx_studio_runtime.domain.speech import SpeechCapabilities, speech_capabilities


def scan_speech(root: Path, config: dict[str, object]) -> SpeechCapabilities:
    capabilities = speech_capabilities(config)
    required = ("tokenizer_config.json", "speech_tokenizer/config.json")
    complete = all((root / name).is_file() for name in required)
    complete = complete and (
        (root / "tokenizer.json").is_file()
        or all((root / name).is_file() for name in ("vocab.json", "merges.txt"))
    )
    complete = complete and bool(list(root.glob("*.safetensors")))
    complete = complete and bool(list((root / "speech_tokenizer").glob("*.safetensors")))
    if complete:
        codec_path = root / "speech_tokenizer/config.json"
        if codec_path.stat().st_size > 2_000_000:
            complete = False
        else:
            codec = json.loads(codec_path.read_text())
            complete = isinstance(codec, dict) and isinstance(codec.get("decoder_config"), dict)
            if capabilities.variant == "base":
                complete = complete and isinstance(codec.get("encoder_config"), dict)
        for directory in (root, root / "speech_tokenizer"):
            complete = complete and _complete_weights(directory)
    if not complete:
        return replace(
            capabilities,
            operations=(),
            unavailable_reason="缺少权重、文本 tokenizer 或语音 codec 资源",
        )
    return capabilities


def _complete_weights(root: Path) -> bool:
    for index in root.glob("*.safetensors.index.json"):
        if index.stat().st_size > 2_000_000:
            return False
        metadata = json.loads(index.read_text())
        weights = metadata.get("weight_map") if isinstance(metadata, dict) else None
        if not isinstance(weights, dict) or not weights:
            return False
        for filename in weights.values():
            if not isinstance(filename, str) or Path(filename).name != filename:
                return False
            if not (root / filename).is_file():
                return False
    return True
