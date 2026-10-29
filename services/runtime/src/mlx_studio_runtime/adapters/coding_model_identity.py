"""Bind tool capability evidence to engine, template/config and weight file versions."""

import hashlib
import json
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from mlx_studio_runtime.domain.drafts import effective_draft
from mlx_studio_runtime.domain.models import ModelManifest


def coding_model_identity(model: ModelManifest) -> tuple[str, str]:
    try:
        engine_version = "scripted-v1" if model.engine == "fake" else version(model.engine)
    except PackageNotFoundError:
        engine_version = "unavailable"
    digest = hashlib.sha256(f"{model.engine}:{engine_version}:mlx-tools-v2".encode())
    if model.engine != "fake":
        root = Path(model.local_path)
        for path in sorted(root.iterdir()):
            if path.name in {"config.json", "tokenizer_config.json", "chat_template.jinja"}:
                if path.stat().st_size > 4 * 1024 * 1024:
                    raise ValueError("MODEL_TEMPLATE_TOO_LARGE")
                digest.update(path.read_bytes())
            elif path.suffix == ".safetensors":
                stat = path.stat()
                digest.update(f"{path.name}:{stat.st_size}:{stat.st_mtime_ns}".encode())
    settings = effective_draft(model.draft, model.mtp)
    digest.update(json.dumps(settings.to_dict(), sort_keys=True).encode())
    # Disabled settings remain editable even if a draft directory disappeared.
    for directory in settings.active_paths():
        draft = Path(directory).expanduser()
        config = draft / "config.json"
        if config.stat().st_size > 1024 * 1024:
            raise ValueError("DRAFT_CONFIG_INVALID")
        digest.update(config.read_bytes())
        stat = (draft / "model.safetensors").stat()
        digest.update(f"{stat.st_size}:{stat.st_mtime_ns}".encode())
    return digest.hexdigest(), f"{model.engine}-{engine_version}; pi-1.2.0"
