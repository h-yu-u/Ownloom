"""Own the bound Qwen MTP head; the target processor always owns tokenization."""

import secrets
from typing import Any, Protocol, runtime_checkable

from mlx_studio_runtime.adapters.mtp_metadata import validate_mtp_files
from mlx_studio_runtime.domain.mtp import MtpLoadError, restore_mtp


@runtime_checkable
class DraftModel(Protocol):
    def bind(self, target_model: Any) -> Any: ...
    def parameters(self) -> Any: ...
    def reset(self, target_model: Any) -> Any: ...


class MtpDraft:
    def __init__(self) -> None:
        self.model: DraftModel | None = None
        self.block_size = 3

    def load(self, manifest: dict[str, object], target: Any) -> None:
        try:
            self._load(manifest, target)
        except Exception as error:  # Model adapter boundary; never silently fall back.
            self.clear()
            raise MtpLoadError("MTP_LOAD_FAILED") from error

    def _load(self, manifest: dict[str, object], target: Any) -> None:
        settings = restore_mtp(manifest.get("mtp"))
        if settings is None:
            return
        settings = validate_mtp_files(str(manifest["engine"]), str(manifest["localPath"]), settings)
        import mlx.core as mx  # type: ignore[import-not-found]
        from mlx_vlm.speculative import load_drafter  # type: ignore[import-not-found]
        from mlx_vlm.speculative.drafters import (  # type: ignore[import-not-found]
            validate_drafter_compatibility,
        )

        draft, kind = load_drafter(settings.draft_path, kind="mtp", trust_remote_code=False)
        if kind != "mtp" or not isinstance(draft, DraftModel):
            raise ValueError("MTP_DRAFT_UNSUPPORTED")
        validate_drafter_compatibility(target, draft, kind)
        draft.bind(target)
        mx.eval(draft.parameters())
        mx.synchronize()
        self.model, self.block_size = draft, settings.block_size

    def options(self, *, temperature: float = 0, has_images: bool = False) -> dict[str, Any]:
        if self.model is None or has_images:
            return {}
        options = {
            "draft_model": self.model,
            "draft_kind": "mtp",
            "draft_block_size": self.block_size,
        }
        if temperature > 0:
            # MLX 0.32.1 random.state is read-only. VLM 0.6.14's seeded,
            # position-based target sampler avoids its legacy state-assignment
            # path while retaining stochastic sampling at the requested temperature.
            options["seed"] = secrets.randbits(32)
        return options

    def finish(self, target: Any) -> None:
        if self.model is not None:
            # Discard partial speculative KV and hidden states on every exit,
            # including generator.close(); target APC snapshots have their own owner.
            self.model.reset(target)

    def clear(self) -> None:
        # The head holds target embedding/output references. Drop it before target release.
        self.model = None
