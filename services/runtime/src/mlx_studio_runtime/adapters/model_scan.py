"""Bounded static filesystem scan; never executes model code."""

import hashlib
import json
import uuid
from pathlib import Path
from typing import cast

from mlx_studio_runtime.adapters.speech_model_scan import scan_speech
from mlx_studio_runtime.domain.models import (
    ModelCapabilities,
    ModelManifest,
    ModelSource,
    infer_model_kind,
    stable_metadata,
)


def manifest_from_directory(
    path: Path,
    source: ModelSource = "local",
    revision: str | None = None,
    display_name: str | None = None,
) -> ModelManifest:
    """Read bounded JSON metadata without importing or executing model code."""
    resolved = path.expanduser().resolve()
    if not resolved.is_dir():
        raise ValueError("MODEL_METADATA_INVALID")
    config, model_index = read_model_metadata(resolved)
    if not config and not model_index:
        raise ValueError("MODEL_METADATA_INVALID")
    engine, task = infer_model_kind(config, model_index)
    speech = scan_speech(resolved, config) if engine == "mlx-audio" else None
    editing = supports_qwen21_edit(resolved, model_index)
    input_modalities = ("text", "image") if engine == "mlx-vlm" or editing else ("text",)
    output_modalities = ("image",) if engine == "mflux" else ("text",)
    if speech:
        input_modalities = ("text", "audio") if speech.variant == "base" else ("text",)
        output_modalities = ("audio",)
    elif engine == "unknown":
        input_modalities, output_modalities = (), ()
    text_config = config.get("text_config")
    context_length = config.get("max_position_embeddings")
    if context_length is None and isinstance(text_config, dict):
        context_length = cast(dict[str, object], text_config).get("max_position_embeddings")
    weight_files = sorted(
        (file for file in resolved.rglob("*.safetensors") if file.is_file()),
        key=lambda file: file.relative_to(resolved).as_posix(),
    )
    directory_name = resolved.name
    if directory_name.endswith("-bit") and directory_name.removesuffix("-bit").isdigit():
        directory_name = f"{resolved.parent.name} · {directory_name}"
    return ModelManifest(
        id=f"installation-{uuid.uuid5(uuid.NAMESPACE_URL, f'{source}:{resolved}:{revision}')}",
        artifact_identity=f"{source}:{revision or 'unresolved'}:metadata-sha256:"
        + model_fingerprint(
            config,
            model_index,
            resolved,
            weight_files,
        ),
        display_name=display_name
        or str(config.get("_name_or_path") or model_index.get("_name_or_path") or directory_name),
        source=source,
        local_path=str(resolved),
        engine=engine,
        task=task,
        speech=speech,
        compatibility_status="partial" if speech and speech.unavailable_reason else "unknown",
        input_modalities=input_modalities,
        output_modalities=output_modalities,
        revision=revision,
        context_length=context_length if isinstance(context_length, int) else None,
        disk_size_bytes=sum(file.stat().st_size for file in resolved.rglob("*") if file.is_file()),
        capabilities=ModelCapabilities(
            streaming=engine in {"mlx-lm", "mlx-vlm"},
            lora=engine == "mflux",
            image_editing=editing,
            inpainting=editing,
            multi_image=editing,
        ),
    )


def model_fingerprint(
    config: dict[str, object],
    model_index: dict[str, object],
    root: Path,
    weight_files: list[Path],
) -> str:
    digest = hashlib.sha256()
    for metadata in (config, model_index):
        digest.update(
            json.dumps(
                stable_metadata(metadata),
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        )
    for file in weight_files:
        relative = file.relative_to(root).as_posix()
        digest.update(f"{relative}:{file.stat().st_size}".encode())
    return digest.hexdigest()


def read_model_metadata(root: Path) -> tuple[dict[str, object], dict[str, object]]:
    """Read bounded static metadata, including native MFLUX exports without root configs."""
    config = _read_json(root / "config.json")
    index = _read_json(root / "model_index.json")
    if config or index:
        return config, index
    components = {
        name: _read_json(root / name / "model.safetensors.index.json")
        for name in ("transformer", "text_encoder", "vae")
    }
    maps: dict[str, dict[str, object]] = {}
    for name, component in components.items():
        weights = component.get("weight_map")
        metadata = component.get("metadata")
        if not isinstance(weights, dict) or not weights or not isinstance(metadata, dict):
            return {}, {}
        if not metadata.get("mflux_version"):
            return {}, {}
        maps[name] = cast(dict[str, object], weights)
    # The shared modulation, 32 diffusion blocks and Q/K-normalized text encoder
    # identify the 2.1 architecture independently of the directory/display name.
    if (
        not {
            "modulation.layers.1.weight",
            "transformer_blocks.31.attn.to_q.weight",
            "transformer_blocks.31.img_mlp.gate_layer.weight",
        }.issubset(maps["transformer"])
        or "layers.35.self_attn.q_norm.weight" not in maps["text_encoder"]
    ):
        return {}, {}
    for name, weights in maps.items():
        for filename in weights.values():
            if not isinstance(filename, str) or Path(filename).name != filename:
                raise ValueError("MODEL_METADATA_INVALID")
            file = root / name / filename
            if file.suffix != ".safetensors" or not file.is_file():
                raise ValueError("MODEL_WEIGHTS_INCOMPLETE")
    for filename in ("tokenizer.json", "tokenizer_config.json"):
        if not (root / "processor" / filename).is_file():
            raise ValueError("MODEL_TOKENIZER_INCOMPLETE")
    return {"model_type": "qwen_image_21", "export_manifest": _read_json(root / "manifest.json")}, {
        "_class_name": "QwenImage21Pipeline",
    }


def supports_qwen21_edit(root: Path, index: dict[str, object]) -> bool:
    """Require complete reference-capable static metadata, never infer from a name."""
    if index.get("_class_name") != "QwenImage21Pipeline":
        return False
    configs = [
        _read_json(root / name / "config.json") for name in ("transformer", "vae", "text_encoder")
    ]
    if not all(configs) or not isinstance(configs[2].get("vision_config"), dict):
        return False
    weights = _read_json(root / "text_encoder" / "model.safetensors.index.json").get("weight_map")
    if not isinstance(weights, dict) or not any(str(key).startswith("visual.") for key in weights):
        return False
    return (root / "processor" / "preprocessor_config.json").is_file()


def _read_json(path: Path) -> dict[str, object]:
    if not path.is_file():
        return {}
    if path.stat().st_size > 2_000_000:
        raise ValueError("MODEL_METADATA_INVALID")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("MODEL_METADATA_INVALID")
    return cast(dict[str, object], value)
