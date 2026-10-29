"""Explicit draft enable switch; disabled settings retain the chosen directories."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from mlx_studio_runtime.domain.drafts import DraftSettings


class DraftSettingsView(BaseModel):
    enabled: bool = False
    mode: Literal["auto", "mtp", "dflash2"] = "auto"
    mtpPath: str | None = None
    dflashPath: str | None = None
    mtpBlockSize: Literal[3, 4] = 3
    dflashBlockSize: Literal[4, 5] = 5


class DraftSettingsRequest(DraftSettingsView):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    mtpPath: str | None = Field(default=None, min_length=1, max_length=4096)
    dflashPath: str | None = Field(default=None, min_length=1, max_length=4096)

    def settings(self) -> DraftSettings:
        return DraftSettings(
            self.enabled,
            self.mode,
            self.mtpPath,
            self.dflashPath,
            self.mtpBlockSize,
            self.dflashBlockSize,
        )

    @model_validator(mode="after")
    def validate_settings(self) -> "DraftSettingsRequest":
        self.settings()
        return self
