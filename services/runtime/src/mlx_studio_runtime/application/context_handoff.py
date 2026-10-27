"""Freeze explicitly selected immutable message versions without inheriting execution rights."""

import hashlib
from collections.abc import Callable
from typing import Any

from mlx_studio_runtime.application.ports import ConversationRepository
from mlx_studio_runtime.domain.chat_context import fingerprint
from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class ContextHandoffs:
    def __init__(
        self, conversations: ConversationRepository, protect: Callable[[str, str], None]
    ) -> None:
        self.conversations, self.protect = conversations, protect

    def freeze(self, request: dict[str, Any], owner: str) -> dict[str, Any]:
        selected = request["messages"]
        identifiers = [item["id"] for item in selected]
        if not identifiers or len(identifiers) != len(set(identifiers)):
            raise RuntimeFault(RuntimeErrorInfo("CONTEXT_HANDOFF_INVALID", "请选择不同的消息"))
        messages = self.conversations.handoff_messages(request["sourceConversationId"], identifiers)
        for message, reference in zip(messages, selected, strict=True):
            digest = hashlib.sha256(message["content"].encode()).hexdigest()
            if digest != reference["contentHash"]:
                raise RuntimeFault(
                    RuntimeErrorInfo("CONTEXT_HANDOFF_CHANGED", "来源消息版本已改变，请重新预览")
                )
        if sum(len(item["content"]) for item in messages) > 24000:
            raise RuntimeFault(
                RuntimeErrorInfo("CONTEXT_HANDOFF_TOO_LARGE", "选中文字超过预算，请选择较短消息")
            )
        for message in messages:
            for attachment in message["attachments"]:
                # History references remain protected until their owner explicitly releases them.
                self.protect(attachment["id"], owner)
        return {
            **request,
            "resolvedMessages": messages,
            "digest": fingerprint(request),
            "attachmentMode": "provenance_only",
            "permissionInheritance": False,
        }
