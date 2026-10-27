"""Emit complete UTF-8 characters immediately for supported byte-level BPE tokenizers."""

import codecs
from typing import Any


class UTF8StreamingDetokenizer:
    def __init__(self, token_bytes: tuple[bytes, ...]) -> None:
        self.token_bytes = token_bytes
        self.reset()

    def __copy__(self) -> "UTF8StreamingDetokenizer":
        return type(self)(self.token_bytes)

    def reset(self) -> None:
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self.offset = 0
        self.text = ""
        self.tokens: list[int] = []

    def add_token(self, token: int, skip_special_token_ids: list[int] | None = None) -> None:
        if skip_special_token_ids and token in skip_special_token_ids:
            return
        self.tokens.append(token)
        self.text += self.decoder.decode(self.token_bytes[token], final=False)

    def finalize(self) -> None:
        self.text += self.decoder.decode(b"", final=True)

    @property
    def last_segment(self) -> str:
        segment = self.text[self.offset :]
        self.offset = len(self.text)
        return segment


def configure_streaming_decoder(processor: Any) -> None:
    previous: Any = getattr(processor, "detokenizer", None)
    if previous is None:
        return
    from mlx_vlm.tokenizer_utils import BPEStreamingDetokenizer  # type: ignore[import-not-found]

    # Keep other decoder families and space-trimming behavior unchanged.
    if not isinstance(previous, BPEStreamingDetokenizer) or previous.trim_space:
        return
    byte_map = previous._byte_decoder
    if not isinstance(byte_map, dict):
        return
    token_bytes: list[bytes] = []
    tokens: list[str | None] = list(previous.tokenmap)
    for token in tokens:
        if token is None:
            token_bytes.append(b"")
        elif all(character in byte_map for character in token):
            token_bytes.append(bytes(byte_map[character] for character in token))
        else:
            token_bytes.append(token.encode("utf-8"))
    processor.detokenizer = UTF8StreamingDetokenizer(tuple(token_bytes))
