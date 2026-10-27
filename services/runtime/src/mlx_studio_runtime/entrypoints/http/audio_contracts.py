"""Authoritative Audio Studio HTTP contracts, also used to generate frontend DTOs."""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SpeechOperationView(BaseModel):
    mode: Literal["preset", "clone"]
    referenceAudio: Literal["required", "unsupported"]
    referenceText: Literal["required", "unsupported"]
    stylePrompt: bool
    streamKind: Literal["none"]
    languages: list[str]
    presetSpeakers: list[str]
    maxTextCharacters: int
    maxReferenceSeconds: int


class SpeechCapabilitiesView(BaseModel):
    family: str
    variant: str
    operations: list[SpeechOperationView]
    verification: Literal["candidate", "validated"]
    adapterVersion: str
    unavailableReason: str | None


class AudioAssetView(BaseModel):
    id: str
    original_name: str
    role: Literal["reference", "generated"]
    sha256: str
    format: Literal["wav"]
    size_bytes: int
    sample_rate: int
    channels: int
    duration_seconds: float
    peaks: list[float]
    created_at: int


class VoiceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=80)
    reference_asset_id: str = Field(min_length=1, max_length=200)
    reference_text: str = Field(min_length=1, max_length=2000)
    language: str = Field(min_length=1, max_length=20)
    source: Literal["self", "authorized", "generated"]
    consent: Literal[True]


class VoicePatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    reference_text: str | None = Field(default=None, min_length=1, max_length=2000)
    language: str | None = Field(default=None, min_length=1, max_length=20)

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if not self.model_fields_set or any(
            getattr(self, key) is None for key in self.model_fields_set
        ):
            raise ValueError("Provide non-null changes")
        return self


class VoiceView(VoiceCreate):
    id: str
    version: int
    created_at: int
    consent_at: int


class SpeechOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    format: Literal["wav"] = "wav"


class AudioGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    clientRequestId: str = Field(min_length=1, max_length=100)
    modelId: str = Field(min_length=1, max_length=200)
    mode: Literal["preset", "clone"]
    text: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="auto", min_length=1, max_length=20)
    speaker: str | None = Field(default=None, min_length=1, max_length=100)
    voiceId: str | None = Field(default=None, min_length=1, max_length=200)
    output: SpeechOutput = Field(default_factory=SpeechOutput)

    @model_validator(mode="after")
    def match_mode(self) -> Self:
        if self.mode == "preset" and (not self.speaker or self.voiceId is not None):
            raise ValueError("Preset requires only speaker")
        if self.mode == "clone" and (not self.voiceId or self.speaker is not None):
            raise ValueError("Clone requires only voiceId")
        return self


class AudioSnapshot(BaseModel):
    model_id: str
    model_name: str
    model_revision: str | None
    model_identity: str | None
    adapter_version: str
    mode: Literal["preset", "clone"]
    text: str
    language: str
    speaker: str | None
    voice_id: str | None
    voice_snapshot: VoiceView | None
    simulated: bool


class AudioJobView(AudioSnapshot):
    id: str
    state: Literal[
        "queued", "preparing", "running", "cancelling", "succeeded", "failed", "cancelled"
    ]
    error_code: str | None
    artifact_id: str | None
    created_at: int


class AudioArtifactView(AudioSnapshot):
    id: str
    job_id: str
    asset_id: str
    created_at: int
    sample_rate: int
    channels: int
    duration_seconds: float
    peaks: list[float]
    elapsed_seconds: float
    rtf: float
