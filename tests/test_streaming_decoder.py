import copy
import unittest

from mlx_studio_runtime.adapters.text_engines.streaming_decoder import (
    UTF8StreamingDetokenizer,
)


class StreamingDecoderTests(unittest.TestCase):
    def test_chinese_and_emoji_stream_without_waiting_for_spaces(self) -> None:
        tokens = (
            b"\xe4\xbd",
            b"\xa0",
            "好".encode(),
            b"\xf0\x9f",
            b"\x98\x80",
            b" end",
        )
        decoder = UTF8StreamingDetokenizer(tokens)
        output = []
        for index in range(len(tokens)):
            decoder.add_token(index)
            output.append(decoder.last_segment)
        decoder.finalize()
        output.append(decoder.last_segment)
        self.assertEqual(output, ["", "你", "好", "", "😀", " end", ""])
        self.assertEqual(decoder.text, b"".join(tokens).decode())
        self.assertEqual(decoder.tokens, list(range(len(tokens))))

    def test_skip_special_tokens_reset_and_copy_are_isolated(self) -> None:
        decoder = UTF8StreamingDetokenizer(
            (b"hello", b"<special>", b"\xe4", b"\xbd\xa0")
        )
        decoder.add_token(0)
        decoder.add_token(1, [1])
        self.assertEqual(decoder.last_segment, "hello")
        decoder.add_token(2)
        other = copy.copy(decoder)
        other.add_token(0)
        self.assertEqual(other.last_segment, "hello")
        decoder.add_token(3)
        self.assertEqual(decoder.last_segment, "你")
        decoder.reset()
        self.assertEqual(decoder.text, "")
        self.assertEqual(decoder.tokens, [])

    def test_incomplete_final_utf8_matches_replacement_decode(self) -> None:
        decoder = UTF8StreamingDetokenizer((b"a\xe4",))
        decoder.add_token(0)
        self.assertEqual(decoder.last_segment, "a")
        decoder.finalize()
        self.assertEqual(decoder.text, b"a\xe4".decode(errors="replace"))
