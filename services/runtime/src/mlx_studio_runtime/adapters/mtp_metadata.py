"""Local, bounded static MTP validation; never imports repository code."""

import json
from pathlib import Path
from typing import cast

from mlx_studio_runtime.domain.models import ModelManifest
from mlx_studio_runtime.domain.mtp import MtpSettings


def read_config(directory: Path) -> dict[str, object]:
    path = directory / "config.json"
    if not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise ValueError("MTP_CONFIG_INVALID")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("MTP_CONFIG_INVALID")
    return cast(dict[str, object], value)


def validate_mtp_files(engine: str, model_path: str, settings: MtpSettings) -> MtpSettings:
    if engine != "mlx-vlm":
        raise ValueError("MTP_TARGET_UNSUPPORTED")
    path = Path(settings.draft_path).expanduser()
    if not path.is_absolute() or not path.is_dir():
        raise ValueError("MTP_LOCAL_DIRECTORY_REQUIRED")
    path = path.resolve(strict=True)
    target, draft = read_config(Path(model_path)), read_config(path)
    if target.get("model_type") not in {"qwen3_5", "qwen3_5_moe"}:
        raise ValueError("MTP_TARGET_UNSUPPORTED")
    if draft.get("model_type") != "qwen3_5_mtp":
        raise ValueError("MTP_DRAFT_UNSUPPORTED")
    target_text = target.get("text_config", target)
    draft_text = draft.get("text_config", draft)
    if not isinstance(target_text, dict) or not isinstance(draft_text, dict):
        raise ValueError("MTP_CONFIG_INVALID")
    for key in ("hidden_size", "vocab_size"):
        expected: object = target_text.get(key)
        if type(expected) is not int or expected != draft_text.get(key):
            raise ValueError("MTP_TARGET_MISMATCH")
    weights = path / "model.safetensors"
    if not weights.is_file() or weights.stat().st_size <= 8:
        raise ValueError("MTP_WEIGHTS_MISSING")
    return MtpSettings(str(path), settings.block_size)


def validate_mtp(model: ModelManifest, settings: MtpSettings) -> MtpSettings:
    return validate_mtp_files(model.engine, model.local_path, settings)
