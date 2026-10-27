"""Reference assets and versioned voices; queued jobs hold independent snapshots."""

import time
import uuid
from pathlib import Path
from typing import Any

from mlx_studio_runtime.application.audio_ports import AudioRepository, AudioStorage
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class VoiceProfileService:
    def __init__(self, repository: AudioRepository, files: AudioStorage) -> None:
        self.repository = repository
        self.files = files

    async def upload(self, content: bytes, name: str) -> dict[str, Any]:
        identifier = str(uuid.uuid4())
        metadata = await self.files.upload(content, identifier)
        item = dict(
            metadata,
            id=identifier,
            original_name=Path(name).name[:160],
            role="reference",
            created_at=int(time.time()),
        )
        try:
            self.repository.save_asset(item)
        except Exception:
            self.files.remove(str(item["relative_path"]))
            raise
        return item

    def asset(self, asset_id: str) -> dict[str, Any]:
        item = self.repository.asset(asset_id)
        if item is None:
            raise RuntimeFault(RuntimeErrorInfo("AUDIO_ASSET_NOT_FOUND", "找不到音频素材"))
        return item

    def content(self, asset_id: str) -> Path:
        return self.files.read(str(self.asset(asset_id)["relative_path"]))

    def get(self, voice_id: str) -> dict[str, Any]:
        item = self.repository.voice(voice_id)
        if item is None:
            raise RuntimeFault(RuntimeErrorInfo("VOICE_NOT_FOUND", "找不到此音色"))
        return item

    def create(self, values: dict[str, Any]) -> dict[str, Any]:
        asset = self.asset(str(values["reference_asset_id"]))
        if asset["role"] != "reference":
            raise RuntimeFault(
                RuntimeErrorInfo("VOICE_REFERENCE_INVALID", "请选择已导入的参考音频")
            )
        self.content(str(asset["id"]))
        if values.get("consent") is not True or not str(values.get("reference_text", "")).strip():
            raise RuntimeFault(
                RuntimeErrorInfo("VOICE_CONSENT_REQUIRED", "请填写参考原文并确认声音授权")
            )
        item = dict(
            values,
            id=str(uuid.uuid4()),
            version=1,
            created_at=int(time.time()),
            consent_at=int(time.time()),
        )
        self.repository.save_voice(item)
        return item

    def update(self, voice_id: str, values: dict[str, Any]) -> dict[str, Any]:
        item = self.get(voice_id)
        updated = dict(item, **values)
        updated["version"] = int(item["version"]) + 1
        self.repository.save_voice(updated)
        return updated

    def delete(self, voice_id: str, delete_reference: bool = False) -> None:
        item = self.get(voice_id)
        asset_id = str(item["reference_asset_id"])
        # Keep the profile if a requested complete deletion cannot safely remove its source.
        if delete_reference and self.repository.asset_in_use(asset_id, voice_id):
            raise RuntimeFault(
                RuntimeErrorInfo("AUDIO_ASSET_IN_USE", "参考录音仍被音色或未完成任务使用")
            )
        self.repository.delete_voice(voice_id)
        if delete_reference:
            self.delete_asset(asset_id)

    def delete_asset(self, asset_id: str) -> None:
        item = self.asset(asset_id)
        if self.repository.asset_in_use(asset_id):
            raise RuntimeFault(
                RuntimeErrorInfo("AUDIO_ASSET_IN_USE", "音频仍被音色、作品或未完成任务使用")
            )
        self.files.remove(str(item["relative_path"]))
        self.repository.delete_asset(asset_id)
