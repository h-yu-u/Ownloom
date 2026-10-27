"""User task identity and persisted parent links, independent of inference output."""

from typing import Any
from urllib.parse import urlencode

_WORKSPACES = {
    "chat": ("聊天任务", "/chat"),
    "image": ("图片生成", "/image-studio"),
    "speech": ("语音生成", "/audio-studio"),
}
_TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}


def runtime_task(job: dict[str, Any]) -> dict[str, Any] | None:
    parent = job["parentId"]
    if job["kind"] == "coding-inference" and not parent and job["state"] in _TERMINAL:
        return None  # Unlinked legacy internal steps are not independent user tasks.
    title, target = _WORKSPACES.get(job["kind"], ("工具执行任务", "/coding"))
    session = job["sessionId"]
    if session:
        target = "/chat?" + urlencode({"conversationId": session})
    return {
        **{
            key: job[key]
            for key in (
                "id",
                "state",
                "phase",
                "errorCode",
                "sessionId",
                "parentId",
                "createdAt",
                "kind",
            )
        },
        "owner": "runtime",
        "title": job["title"] or title,
        "target": target,
        "groupId": f"run:{parent}"
        if parent
        else f"chat:{session}"
        if session
        else f"runtime:{job['id']}",
    }


def link_task_parents(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parents = {item["id"]: item for item in items if item["owner"] in {"coding", "agent"}}
    result = []
    for item in items:
        parent = parents.get(item.get("parentId"))
        result.append(
            {
                **item,
                **{key: parent[key] for key in ("groupId", "title", "target", "sessionId")},
            }
            if parent and parent.get("groupId")
            else item
        )
    return result
