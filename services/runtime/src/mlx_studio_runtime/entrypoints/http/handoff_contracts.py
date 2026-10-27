from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HandoffMessageReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=200)
    contentHash: str = Field(pattern=r"^[a-f0-9]{64}$")


class ContextHandoffRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceConversationId: str = Field(min_length=1, max_length=200)
    messages: list[HandoffMessageReference] = Field(min_length=1, max_length=10)
    targetWorkspace: Literal["chat"] = "chat"
