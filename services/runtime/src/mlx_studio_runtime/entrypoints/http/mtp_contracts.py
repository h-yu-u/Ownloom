"""Optional MTP settings: null draftPath explicitly disables acceleration."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MtpSettingsView(BaseModel):
    draftPath: str
    blockSize: Literal[3, 4] = 3


class MtpSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    draftPath: str | None = Field(min_length=1, max_length=4096)
    blockSize: Literal[3, 4] = 3
