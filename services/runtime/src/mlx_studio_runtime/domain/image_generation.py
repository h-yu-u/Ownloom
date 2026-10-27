"""Image request invariants and an immutable reproducible parameter snapshot."""

from dataclasses import asdict, dataclass
from typing import Literal


@dataclass(frozen=True)
class ImageParameters:
    model_id: str
    prompt: str
    width: int
    height: int
    steps: int
    seed: int
    mode: Literal["generate", "edit", "inpaint"] = "generate"
    reference_ids: tuple[str, ...] = ()
    mask_id: str | None = None
    strength: float = 1.0

    def __post_init__(self) -> None:
        if not self.model_id or not self.prompt.strip() or len(self.prompt) > 10_000:
            raise ValueError("IMAGE_PROMPT_INVALID")
        if any(value < 64 or value > 2048 or value % 16 for value in (self.width, self.height)):
            raise ValueError("IMAGE_DIMENSIONS_INVALID")
        if not 1 <= self.steps <= 100 or not 0 <= self.seed <= 2**32 - 1:
            raise ValueError("IMAGE_PARAMETERS_INVALID")
        if self.mode not in {"generate", "edit", "inpaint"} or not 0 < self.strength <= 1:
            raise ValueError("IMAGE_EDIT_PARAMETERS_INVALID")
        if len(self.reference_ids) > 10 or len(set(self.reference_ids)) != len(self.reference_ids):
            raise ValueError("IMAGE_REFERENCES_INVALID")
        if self.mode == "generate" and (self.reference_ids or self.mask_id):
            raise ValueError("IMAGE_REFERENCES_INVALID")
        if self.mode == "generate" and self.strength != 1:
            raise ValueError("IMAGE_EDIT_PARAMETERS_INVALID")
        if self.mode != "generate" and not self.reference_ids:
            raise ValueError("IMAGE_REFERENCE_REQUIRED")
        if (self.mode == "inpaint") != bool(self.mask_id):
            raise ValueError("IMAGE_MASK_REQUIRED")

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def fake_image_manifest_dict() -> dict[str, object]:
    return {
        "id": "builtin-fake-image",
        "displayName": "Fake Image Engine (Development)",
        "source": "builtin",
        "localPath": "fake://image",
        "engine": "fake",
        "task": "image-generation",
        "inputModalities": ["text", "image"],
        "outputModalities": ["image"],
        "compatibility": {"status": "supported"},
        "capabilities": {"imageEditing": True, "inpainting": True, "multiImage": True},
    }
