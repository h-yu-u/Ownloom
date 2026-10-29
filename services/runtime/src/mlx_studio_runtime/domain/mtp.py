"""Explicit, per-installation experimental MTP configuration."""

from dataclasses import dataclass
from typing import cast


class MtpLoadError(RuntimeError):
    """Sanitized adapter load failure, safe to forward across Worker IPC."""


@dataclass(frozen=True)
class MtpSettings:
    draft_path: str
    block_size: int = 3

    def __post_init__(self) -> None:
        if not self.draft_path.strip() or len(self.draft_path) > 4096:
            raise ValueError("MTP_CONFIG_INVALID")
        if type(self.block_size) is not int or self.block_size not in {3, 4}:
            raise ValueError("MTP_CONFIG_INVALID")

    def to_dict(self) -> dict[str, object]:
        return {"draftPath": self.draft_path, "blockSize": self.block_size}


def restore_mtp(value: object) -> MtpSettings | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("MTP_CONFIG_INVALID")
    data = cast(dict[str, object], value)
    path, size = data.get("draftPath"), data.get("blockSize", 3)
    if not isinstance(path, str) or type(size) is not int:
        raise ValueError("MTP_CONFIG_INVALID")
    return MtpSettings(path, size)
