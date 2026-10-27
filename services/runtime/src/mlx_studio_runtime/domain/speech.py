"""Static speech capabilities and strict, immutable synthesis input."""

import errno
from dataclasses import asdict, dataclass
from typing import Literal

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault

SpeechMode = Literal["preset", "clone"]
LANGUAGES = {
    "auto": "auto",
    "zh": "chinese",
    "en": "english",
    "ja": "japanese",
    "ko": "korean",
    "de": "german",
    "fr": "french",
    "ru": "russian",
    "pt": "portuguese",
    "es": "spanish",
    "it": "italian",
}
ADAPTER_VERSION = "qwen3-tts/0.5.9-v1"


def speech_error_code(error: Exception) -> str:
    """Return stable public codes without exposing upstream content or file paths."""
    if isinstance(error, RuntimeFault):
        return error.info.code
    if isinstance(error, MemoryError):
        return "SPEECH_MEMORY_EXHAUSTED"
    if isinstance(error, ImportError):
        return "SPEECH_DEPENDENCY_MISSING"
    if isinstance(error, OSError) and error.errno == errno.ENOSPC:
        return "AUDIO_STORAGE_FULL"
    if isinstance(error, ValueError) and str(error) in {
        "SPEECH_RESOURCES_INCOMPLETE",
        "SPEECH_CODEC_ENCODER_MISSING",
        "SPEECH_ADAPTER_VERSION_MISMATCH",
        "SPEECH_MODE_UNSUPPORTED",
        "SPEECH_PARAMETERS_UNSUPPORTED",
        "SPEECH_SEGMENT_PROTOCOL_INVALID",
        "SPEECH_OUTPUT_TRUNCATED",
        "AUDIO_SAMPLE_RATE_INVALID",
        "AUDIO_OUTPUT_INVALID",
        "AUDIO_OUTPUT_EMPTY",
        "AUDIO_TOO_LARGE",
        "AUDIO_PATH_INVALID",
        "AUDIO_REFERENCE_PATH_INVALID",
        "AUDIO_OUTPUT_ROOT_MISSING",
    }:
        return str(error)
    if isinstance(error, RuntimeError) and "out of memory" in str(error).lower():
        return "SPEECH_MEMORY_EXHAUSTED"
    return "SPEECH_GENERATION_FAILED"


@dataclass(frozen=True)
class SpeechOperation:
    mode: SpeechMode
    languages: tuple[str, ...] = tuple(LANGUAGES)
    preset_speakers: tuple[str, ...] = ()
    max_text_characters: int = 2000
    max_reference_seconds: int = 30

    def to_dict(self) -> dict[str, object]:
        return {
            "mode": self.mode,
            "languages": list(self.languages),
            "presetSpeakers": list(self.preset_speakers),
            "referenceAudio": "required" if self.mode == "clone" else "unsupported",
            "referenceText": "required" if self.mode == "clone" else "unsupported",
            "stylePrompt": False,
            "streamKind": "none",
            "maxTextCharacters": self.max_text_characters,
            "maxReferenceSeconds": self.max_reference_seconds,
        }


@dataclass(frozen=True)
class SpeechCapabilities:
    family: str
    variant: str
    operations: tuple[SpeechOperation, ...]
    verification: Literal["candidate", "validated"] = "candidate"
    adapter_version: str = ADAPTER_VERSION
    unavailable_reason: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "family": self.family,
            "variant": self.variant,
            "operations": [operation.to_dict() for operation in self.operations],
            "verification": self.verification,
            "adapterVersion": self.adapter_version,
            "unavailableReason": self.unavailable_reason,
        }


def speech_capabilities(config: dict[str, object]) -> SpeechCapabilities:
    variant = str(config.get("tts_model_type", "unknown"))
    talker = config.get("talker_config")
    speakers = talker.get("spk_id") if isinstance(talker, dict) else None
    operations: tuple[SpeechOperation, ...] = ()
    if variant == "base":
        operations = (SpeechOperation("clone"),)
    elif variant == "custom_voice" and isinstance(speakers, dict) and speakers:
        operations = (SpeechOperation("preset", preset_speakers=tuple(str(k) for k in speakers)),)
    return SpeechCapabilities(
        "qwen3_tts",
        variant,
        operations,
        unavailable_reason=None if operations else "此语音模型变体尚未适配或缺少音色目录",
    )


@dataclass(frozen=True)
class SpeechParameters:
    model_id: str
    mode: SpeechMode
    text: str
    language: str = "auto"
    speaker: str | None = None
    voice_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def validate_speech(parameters: SpeechParameters, capabilities: SpeechCapabilities | None) -> None:
    operation = (
        next((op for op in capabilities.operations if op.mode == parameters.mode), None)
        if capabilities
        else None
    )
    if operation is None:
        raise RuntimeFault(RuntimeErrorInfo("SPEECH_MODE_UNSUPPORTED", "模型不支持此语音模式"))
    if not parameters.text.strip() or len(parameters.text) > operation.max_text_characters:
        raise RuntimeFault(RuntimeErrorInfo("SPEECH_TEXT_INVALID", "请输入 1–2000 字的朗读文字"))
    if parameters.language not in operation.languages:
        raise RuntimeFault(RuntimeErrorInfo("SPEECH_LANGUAGE_INVALID", "模型不支持所选语言"))
    if parameters.mode == "preset":
        valid = parameters.speaker in operation.preset_speakers and parameters.voice_id is None
    else:
        valid = bool(parameters.voice_id) and parameters.speaker is None
    if not valid:
        raise RuntimeFault(RuntimeErrorInfo("SPEECH_INPUT_INVALID", "音色参数与生成模式不匹配"))
