# fmt: off
# ruff: noqa
"""Generated from the Host schema; do not edit."""
from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field

class ExtensionSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skillIds: list[str] = Field(max_length=16)
    toolIds: list[str] = Field(max_length=16)
    mediaBindings: ExtensionMediaBindings | None = Field(default=None)

class ExtensionScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workspace: Literal['chat', 'coding', 'image', 'audio']
    kind: Literal['workspace', 'project', 'session']
    scopeId: str = Field(min_length=1, max_length=128)

class ExtensionRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    revision: int = Field(ge=1)
    digest: str = Field(min_length=1, max_length=64)

class SkillFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    relativePath: str = Field(min_length=1, max_length=4096)
    digest: str = Field(min_length=1, max_length=64)
    size: int = Field(ge=0)

class ExtensionSkill(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    revision: int = Field(ge=1)
    digest: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=1024)
    source: Literal['builtin', 'local-import']
    sourceRef: str = Field(min_length=1, max_length=4096)
    enabled: bool
    workspaces: list[Literal['chat', 'coding', 'image', 'audio']] = Field(max_length=4)
    requiredCapabilities: list[str] = Field(max_length=16)
    files: list[SkillFile] = Field(max_length=200)
    contentRevision: int | None = Field(default=None, ge=1)

class SkillInspection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skill: ExtensionSkill
    body: str = Field(max_length=65536)
    diagnostics: list[str] = Field(max_length=200)

class McpStdioTransport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal['stdio']
    executable: str = Field(min_length=1, max_length=4096)
    args: list[str] = Field(max_length=64)
    cwd: str = Field(min_length=1, max_length=4096)
    publicEnv: dict[str, str]
    secretRefs: dict[str, str]

class McpHttpTransport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal['streamable-http']
    url: str = Field(min_length=1, max_length=4096)
    publicHeaders: dict[str, str]
    secretRefs: dict[str, str]
    authMode: Literal['none', 'bearer', 'api-key']

McpTransport = McpStdioTransport | McpHttpTransport
class McpServer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    revision: int = Field(ge=1)
    digest: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    enabled: bool
    transport: McpTransport
    allowedTools: list[str] = Field(max_length=64)
    readOnlyTools: list[str] = Field(max_length=64)
    credentialConfigured: bool

class ExtensionTool(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=512)
    serverId: str = Field(min_length=1, max_length=128)
    originalName: str = Field(min_length=1, max_length=256)
    modelName: str = Field(min_length=1, max_length=64)
    schemaDigest: str = Field(min_length=1, max_length=64)
    description: str = Field(max_length=4096)
    inputSchema: dict[str, Any]
    risk: Literal['read', 'ask']

class McpInventory(BaseModel):
    model_config = ConfigDict(extra="forbid")
    serverId: str = Field(min_length=1, max_length=128)
    configRevision: int = Field(ge=0)
    inventoryRevision: int = Field(ge=0)
    digest: str = Field(min_length=1, max_length=64)
    tools: list[ExtensionTool] = Field(max_length=128)
    resources: list[dict[str, Any]] = Field(max_length=200)

class ExtensionBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=512)
    revision: int = Field(ge=0)
    scope: ExtensionScope
    selection: ExtensionSelection

class ExtensionSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal[1]
    workspace: Literal['chat', 'coding', 'image', 'audio']
    catalogRevision: int = Field(ge=0)
    policyEpoch: int = Field(ge=0)
    skills: list[ExtensionSkill] = Field(max_length=16)
    servers: list[McpServer] = Field(max_length=16)
    tools: list[ExtensionTool] = Field(max_length=16)
    snapshotDigest: str = Field(min_length=1, max_length=64)
    mediaBindings: ExtensionMediaBindings | None = Field(default=None)
    mode: Literal['analyze', 'develop', 'review'] | None = Field(default=None)

class ExtensionResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    snapshot: ExtensionSnapshot
    totalToolCount: int = Field(ge=0)
    estimatedContextTokens: int = Field(ge=0)

class ExtensionOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    serverId: str = Field(min_length=1, max_length=128)
    state: Literal['running', 'cancelled', 'failed', 'succeeded', 'interrupted']
    errorCode: str | None
    inventory: McpInventory | None

class ExtensionEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seq: int = Field(ge=0)
    type: Literal['extension.config_updated', 'skill.version_published', 'mcp.inventory_changed', 'capability.revoked']
    targetId: str = Field(min_length=1, max_length=512)
    catalogRevision: int = Field(ge=0)
    policyEpoch: int = Field(ge=0)

class ExtensionCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid")
    catalogRevision: int = Field(ge=0)
    policyEpoch: int = Field(ge=0)
    skills: list[ExtensionSkill] = Field(max_length=200)
    servers: list[McpServer] = Field(max_length=200)
    inventories: list[McpInventory] = Field(max_length=200)
    builtinTools: list[ExtensionTool]

class ExtensionMutation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mutationId: str = Field(min_length=1, max_length=128)
    targetId: str = Field(min_length=1, max_length=512)
    revision: int = Field(ge=0)

class SkillImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mutationId: str = Field(min_length=1, max_length=128)
    path: str = Field(min_length=1, max_length=4096)
    id: str | None = Field(default=None, min_length=1, max_length=128)
    expectedRevision: int | None = Field(default=None, ge=0)
    workspaces: list[Literal['chat', 'coding', 'image', 'audio']] = Field(max_length=4)
    requiredCapabilities: list[str] = Field(max_length=16)
    expectedDigest: str | None = Field(default=None, min_length=1, max_length=64)

class McpSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mutationId: str = Field(min_length=1, max_length=128)
    id: str | None = Field(default=None, min_length=1, max_length=128)
    expectedRevision: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=80)
    enabled: bool
    transport: McpTransport
    allowedTools: list[str] = Field(max_length=64)
    readOnlyTools: list[str] = Field(max_length=64)
    credentialIntent: str | None = Field(default=None, min_length=1, max_length=64)

class ExtensionResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: ExtensionScope
    selection: ExtensionSelection | None = Field(default=None)
    mode: Literal['analyze', 'develop', 'review'] | None = Field(default=None)
    contextBudget: int | None = Field(default=None, ge=4096, le=32768)
    channel: Literal['text', 'agent'] | None = Field(default=None)

class ExtensionMediaBindings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    imageModelId: str | None = Field(default=None, min_length=1, max_length=200)
    speechModelId: str | None = Field(default=None, min_length=1, max_length=200)
    speechMode: Literal['preset', 'clone'] | None = Field(default=None)
    speaker: str | None = Field(default=None, min_length=1, max_length=200)
    voiceId: str | None = Field(default=None, min_length=1, max_length=200)
    imageMode: Literal['generate', 'edit', 'inpaint'] | None = Field(default=None)
    imageReferenceIds: list[str] | None = Field(default=None, max_length=10)
    imageMaskId: str | None = Field(default=None, min_length=1, max_length=200)

ExtensionSelection.model_rebuild()
ExtensionScope.model_rebuild()
ExtensionRef.model_rebuild()
SkillFile.model_rebuild()
ExtensionSkill.model_rebuild()
SkillInspection.model_rebuild()
McpStdioTransport.model_rebuild()
McpHttpTransport.model_rebuild()
McpServer.model_rebuild()
ExtensionTool.model_rebuild()
McpInventory.model_rebuild()
ExtensionBinding.model_rebuild()
ExtensionSnapshot.model_rebuild()
ExtensionResolution.model_rebuild()
ExtensionOperation.model_rebuild()
ExtensionEvent.model_rebuild()
ExtensionCatalog.model_rebuild()
ExtensionMutation.model_rebuild()
SkillImportRequest.model_rebuild()
McpSaveRequest.model_rebuild()
ExtensionResolveRequest.model_rebuild()
ExtensionMediaBindings.model_rebuild()
