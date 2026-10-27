"""Bind tool capability evidence to engine, template/config and weight file versions."""

import hashlib
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

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
    return digest.hexdigest(), f"{model.engine}-{engine_version}; pi-1.2.0"
