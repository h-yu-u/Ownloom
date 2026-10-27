"""Serialized UTF-8 limits shared by both ends of the Worker transport."""

MAX_FRAME_BYTES = 16 * 1024 * 1024
MAX_RESULT_BYTES = 16 * 1024 * 1024
MAX_DELTA_BYTES = 64 * 1024
MAX_TOOL_ARGUMENT_BYTES = 2 * 1024 * 1024
STREAM_QUEUE_SIZE = 32
LIMITS = {
    "frameBytes": MAX_FRAME_BYTES,
    "resultBytes": MAX_RESULT_BYTES,
    "deltaBytes": MAX_DELTA_BYTES,
    "toolArgumentBytes": MAX_TOOL_ARGUMENT_BYTES,
}


def text_parts(text: str) -> list[str]:
    # This bound also fits escaped JSON (six bytes per code point).
    return [text[i : i + 8192] for i in range(0, len(text), 8192)]
