"""One target, optional heads, one request-scoped accelerator and cleanup owner."""

import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from mlx_studio_runtime.adapters.draft_metadata import validate_dflash_files
from mlx_studio_runtime.adapters.text_engines.mtp import MtpDraft
from mlx_studio_runtime.domain.drafts import DraftLoadError, effective_draft, restore_draft
from mlx_studio_runtime.domain.mtp import MtpSettings, restore_mtp


class DraftAcceleration:
    def __init__(self, mtp: MtpDraft) -> None:
        self.mtp = mtp
        self.dflash: Any = None
        self.settings = None

    def load(self, manifest: dict[str, object], target: Any) -> None:
        self.settings = effective_draft(
            restore_draft(manifest.get("draft")), restore_mtp(manifest.get("mtp"))
        )
        if not self.settings.enabled:
            return
        try:
            if self.settings.mode in {"auto", "mtp"} and self.settings.mtp_path:
                settings = MtpSettings(self.settings.mtp_path, self.settings.mtp_block_size)
                self.mtp.load({**manifest, "mtp": settings.to_dict()}, target)
            if self.settings.mode in {"auto", "dflash2"} and self.settings.dflash_path:
                self._load_dflash(manifest, target)
        except Exception as error:  # Adapter boundary; release partial bindings and sanitize.
            self.clear()
            raise DraftLoadError("DRAFT_LOAD_FAILED") from error

    def _load_dflash(self, manifest: dict[str, object], target: Any) -> None:
        if self.settings is None or self.settings.dflash_path is None:
            raise ValueError("DRAFT_CONFIG_INVALID")
        if manifest["engine"] != "mlx-vlm":
            raise ValueError("DRAFT_TARGET_UNSUPPORTED")
        path = validate_dflash_files(str(manifest["localPath"]), self.settings.dflash_path)
        import mlx.core as mx  # type: ignore[import-not-found]

        from mlx_studio_runtime.adapters.text_engines.dflash2.bridge import DFlash2Bridge
        from mlx_studio_runtime.adapters.text_engines.dflash2.loader import load_draft

        self.dflash = DFlash2Bridge(load_draft(path))
        self.dflash.bind(target)
        mx.eval(self.dflash.parameters())
        mx.synchronize()

    def select(self, *, coding: bool = False, has_images: bool = False) -> str | None:
        if self.settings is None:  # Legacy MTP owner (including isolated adapter tests).
            return None if has_images else "mtp"
        return self.settings.select(coding=coding, has_images=has_images)

    @contextmanager
    def request(
        self, target: Any, *, temperature: float, coding: bool = False, has_images: bool = False
    ) -> Iterator[dict[str, Any]]:
        kind = self.select(coding=coding, has_images=has_images)
        try:
            if kind == "dflash2":
                if self.dflash is None or self.settings is None:
                    raise ValueError("DRAFT_NOT_LOADED")
                self.dflash.begin_request(target)
                options = {
                    "draft_model": self.dflash,
                    "draft_kind": "dflash",
                    "draft_block_size": self.settings.dflash_block_size,
                    "prefill_step_size": 512,
                }
                if temperature > 0:
                    options["seed"] = secrets.randbits(32)
                yield options
            else:
                yield self.mtp.options(temperature=temperature) if kind == "mtp" else {}
        finally:
            if kind == "dflash2" and self.dflash is not None:
                self.dflash.end_request()
            elif kind == "mtp":
                self.mtp.finish(target)

    def clear(self) -> None:
        if self.dflash is not None:
            self.dflash.close()
        self.dflash = None
        self.mtp.clear()
        self.settings = None
