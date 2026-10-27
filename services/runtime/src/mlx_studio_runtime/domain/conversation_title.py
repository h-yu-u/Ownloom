"""Deterministic short titles from the first meaningful user input."""

DEFAULT_CONVERSATION_TITLES = ("新对话", "新开发会话")


def input_title(content: str) -> str:
    return " ".join(content.split())[:7]
