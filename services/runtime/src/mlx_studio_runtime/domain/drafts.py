"""Persisted draft opt-in and request routing, independent of model libraries."""

from dataclasses import dataclass
from typing import Literal, cast

from mlx_studio_runtime.domain.mtp import MtpSettings

DraftMode = Literal["auto", "mtp", "dflash2"]


class DraftLoadError(RuntimeError):
    """Sanitized draft load failure across the Worker boundary."""


@dataclass(frozen=True)
class DraftSettings:
    enabled: bool = False
    mode: DraftMode = "auto"
    mtp_path: str | None = None
    dflash_path: str | None = None
    mtp_block_size: int = 3
    dflash_block_size: int = 5

    def __post_init__(self) -> None:
        if (
            type(self.enabled) is not bool
            or not isinstance(self.mode, str)
            or self.mode not in {"auto", "mtp", "dflash2"}
        ):
            raise ValueError("DRAFT_CONFIG_INVALID")
        for path in (self.mtp_path, self.dflash_path):
            if path is not None and (
                not isinstance(path, str) or not path.strip() or len(path) > 4096
            ):
                raise ValueError("DRAFT_CONFIG_INVALID")
        if type(self.mtp_block_size) is not int or self.mtp_block_size not in {3, 4}:
            raise ValueError("DRAFT_CONFIG_INVALID")
        if type(self.dflash_block_size) is not int or self.dflash_block_size not in {4, 5}:
            raise ValueError("DRAFT_CONFIG_INVALID")
        if self.enabled:
            if self.mode in {"auto", "mtp"} and not self.mtp_path:
                raise ValueError("DRAFT_MTP_REQUIRED")
            if self.mode in {"auto", "dflash2"} and not self.dflash_path:
                raise ValueError("DRAFT_DFLASH_REQUIRED")

    def to_dict(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "mtpPath": self.mtp_path,
            "dflashPath": self.dflash_path,
            "mtpBlockSize": self.mtp_block_size,
            "dflashBlockSize": self.dflash_block_size,
        }

    def select(self, *, coding: bool = False, has_images: bool = False) -> str | None:
        if not self.enabled or has_images:
            return None
        return ("dflash2" if coding else "mtp") if self.mode == "auto" else self.mode

    def active_paths(self) -> tuple[str, ...]:
        if not self.enabled:
            return ()
        return tuple(
            path
            for path, selected in (
                (self.mtp_path, self.mode in {"auto", "mtp"}),
                (self.dflash_path, self.mode in {"auto", "dflash2"}),
            )
            if path and selected
        )

    def paths(self) -> tuple[str, ...]:
        return tuple(path for path in (self.mtp_path, self.dflash_path) if path)


def restore_draft(value: object) -> DraftSettings | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("DRAFT_CONFIG_INVALID")
    data = cast(dict[str, object], value)
    enabled, mode = data.get("enabled", False), data.get("mode", "auto")
    mtp, dflash = data.get("mtpPath"), data.get("dflashPath")
    mtp_size, dflash_size = data.get("mtpBlockSize", 3), data.get("dflashBlockSize", 5)
    if (
        type(enabled) is not bool
        or mode not in ("auto", "mtp", "dflash2")
        or (mtp is not None and not isinstance(mtp, str))
        or (dflash is not None and not isinstance(dflash, str))
        or type(mtp_size) is not int
        or type(dflash_size) is not int
    ):
        raise ValueError("DRAFT_CONFIG_INVALID")
    return DraftSettings(enabled, cast(DraftMode, mode), mtp, dflash, mtp_size, dflash_size)


def effective_draft(settings: DraftSettings | None, legacy: MtpSettings | None) -> DraftSettings:
    if settings is not None:
        return settings
    if legacy is not None:
        return DraftSettings(True, "mtp", legacy.draft_path, mtp_block_size=legacy.block_size)
    return DraftSettings()
