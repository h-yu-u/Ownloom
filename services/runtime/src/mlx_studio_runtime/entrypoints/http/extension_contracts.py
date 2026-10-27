"""Desktop write inputs contain one-time secrets, never persistent Keychain references."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from mlx_studio_runtime.entrypoints.http.extension_models import ExtensionScope, ExtensionSelection


class StrictExtensionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StdioInput(StrictExtensionRequest):
    type: Literal["stdio"]
    executable: str = Field(min_length=1, max_length=4096)
    args: list[str] = Field(default_factory=list, max_length=64)
    cwd: str = Field(min_length=1, max_length=4096)
    publicEnv: dict[str, str] = Field(default_factory=dict)


class HttpInput(StrictExtensionRequest):
    type: Literal["streamable-http"]
    url: str = Field(min_length=1, max_length=4096)
    publicHeaders: dict[str, str] = Field(default_factory=dict)
    authMode: Literal["none", "bearer", "api-key"] = "none"


class CredentialKeep(StrictExtensionRequest):
    action: Literal["keep"] = "keep"


class CredentialReplace(StrictExtensionRequest):
    action: Literal["replace"]
    field: str = Field(min_length=1, max_length=128)
    kind: Literal["bearer", "api-key", "env"]
    value: str = Field(min_length=1, max_length=8192)


class CredentialClear(StrictExtensionRequest):
    action: Literal["clear"]
    field: str = Field(min_length=1, max_length=128)


class McpWriteRequest(StrictExtensionRequest):
    mutationId: str = Field(min_length=1, max_length=128)
    id: str | None = None
    expectedRevision: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=80)
    enabled: bool = False
    transport: StdioInput | HttpInput = Field(discriminator="type")
    allowedTools: list[str] = Field(default_factory=list, max_length=64)
    readOnlyTools: list[str] = Field(default_factory=list, max_length=64)
    credential: CredentialKeep | CredentialReplace | CredentialClear = Field(
        default_factory=CredentialKeep, discriminator="action"
    )


class ExtensionToggle(StrictExtensionRequest):
    mutationId: str = Field(min_length=1, max_length=128)
    expectedRevision: int = Field(ge=1)
    enabled: bool


class McpTestRequest(StrictExtensionRequest):
    configRevision: int = Field(ge=1)


class BindingUpdate(StrictExtensionRequest):
    mutationId: str = Field(min_length=1, max_length=128)
    expectedRevision: int = Field(ge=0)
    scope: ExtensionScope
    selection: ExtensionSelection


class RevokeRequest(StrictExtensionRequest):
    mutationId: str = Field(min_length=1, max_length=128)
    targetId: str = Field(min_length=1, max_length=128)


class TextAssistantRequest(StrictExtensionRequest):
    submissionId: str = Field(min_length=1, max_length=128)
    workspace: Literal["image", "audio"]
    text: str = Field(min_length=1, max_length=32000)
    modelId: str = Field(min_length=1, max_length=200)
    selection: ExtensionSelection | None = None


class TextAssistantView(BaseModel):
    jobId: str
    state: str
    errorCode: str | None
    text: str
