"""Static local-only draft validation before taking a model execution lease."""

from dataclasses import replace
from pathlib import Path

from mlx_studio_runtime.adapters.mtp_metadata import read_config, validate_mtp_files
from mlx_studio_runtime.adapters.text_engines.dflash2.config import parse_config
from mlx_studio_runtime.domain.drafts import DraftSettings
from mlx_studio_runtime.domain.models import ModelManifest
from mlx_studio_runtime.domain.mtp import MtpSettings


def validate_dflash_files(model_path: str, draft_path: str) -> str:
    path = Path(draft_path).expanduser()
    if not path.is_absolute() or not path.is_dir():
        raise ValueError("DRAFT_LOCAL_DIRECTORY_REQUIRED")
    path = path.resolve(strict=True)
    target, draft = read_config(Path(model_path)), read_config(path)
    text = target.get("text_config", target)
    if target.get("model_type") != "qwen3_5" or not isinstance(text, dict):
        raise ValueError("DFLASH_TARGET_UNSUPPORTED")
    if draft.get("architectures") != ["DFlash2DraftModel"]:
        raise ValueError("DFLASH_DRAFT_UNSUPPORTED")
    for left, right in (
        ("hidden_size", "hidden_size"),
        ("vocab_size", "vocab_size"),
        ("num_hidden_layers", "num_target_layers"),
    ):
        if type(text.get(left)) is not int or text[left] != draft.get(right):
            raise ValueError("DFLASH_TARGET_MISMATCH")
    parse_config(draft)
    weights = path / "model.safetensors"
    if not weights.is_file() or weights.stat().st_size <= 8:
        raise ValueError("DFLASH_WEIGHTS_MISSING")
    return str(path)


def validate_draft(model: ModelManifest, settings: DraftSettings) -> DraftSettings:
    # Disabling must work even after a draft was moved or deleted.
    if not settings.enabled:
        return settings
    if model.engine != "mlx-vlm":
        raise ValueError("DRAFT_TARGET_UNSUPPORTED")
    mtp, dflash = settings.mtp_path, settings.dflash_path
    if settings.mode in {"auto", "mtp"} and mtp:
        mtp = validate_mtp_files(
            model.engine, model.local_path, MtpSettings(mtp, settings.mtp_block_size)
        ).draft_path
    if settings.mode in {"auto", "dflash2"} and dflash:
        dflash = validate_dflash_files(model.local_path, dflash)
    return replace(settings, mtp_path=mtp, dflash_path=dflash)
