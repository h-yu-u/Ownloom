"""Static capabilities and worker WAV contract tests without MLX dependencies."""

import json
import os
import struct
import tempfile
import threading
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from mlx_studio_runtime.adapters.audio_engines.worker_audio import WorkerAudioEngine
from mlx_studio_runtime.adapters.model_scan import manifest_from_directory
from mlx_studio_runtime.domain.models import infer_model_kind, manifest_from_dict
from mlx_studio_runtime.domain.speech import speech_capabilities, speech_error_code


class SpeechMetadataTests(unittest.TestCase):
    def test_error_mapping_never_exposes_upstream_input(self):
        self.assertEqual(
            speech_error_code(ValueError("PRIVATE USER TEXT")),
            "SPEECH_GENERATION_FAILED",
        )
        self.assertEqual(speech_error_code(MemoryError()), "SPEECH_MEMORY_EXHAUSTED")
        self.assertEqual(speech_error_code(ImportError()), "SPEECH_DEPENDENCY_MISSING")

    def test_variants_and_sizes_do_not_advertise_unimplemented_style(self):
        for size in ("0b6", "1b7"):
            base = speech_capabilities(
                {"tts_model_type": "base", "tts_model_size": size}
            )
            self.assertEqual(
                [operation.mode for operation in base.operations], ["clone"]
            )
            custom = speech_capabilities(
                {
                    "tts_model_type": "custom_voice",
                    "tts_model_size": size,
                    "talker_config": {"spk_id": {"vivian": 1}},
                }
            )
            self.assertEqual(
                [operation.mode for operation in custom.operations], ["preset"]
            )
            self.assertFalse(custom.operations[0].to_dict()["stylePrompt"])
        self.assertEqual(
            speech_capabilities({"tts_model_type": "voice_design"}).operations, ()
        )
        self.assertEqual(
            infer_model_kind({"model_type": "qwen3_tts", "vision_config": {}}, {}),
            ("mlx-audio", "text-to-speech"),
        )
        self.assertEqual(
            infer_model_kind({"model_type": "totally_unrecognized"}, {}),
            ("unknown", "unknown"),
        )

    def test_scan_requires_codec_encoder_and_all_shards_and_roundtrips_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "config.json").write_text(
                json.dumps({"model_type": "qwen3_tts", "tts_model_type": "base"})
            )
            model = manifest_from_directory(root)
            self.assertEqual(model.output_modalities, ("audio",))
            self.assertEqual(model.speech.operations, ())
            for name in ("tokenizer.json", "tokenizer_config.json"):
                (root / name).write_text("{}")
            (root / "model.safetensors").write_bytes(b"weights")
            codec = root / "speech_tokenizer"
            codec.mkdir()
            (codec / "config.json").write_text(json.dumps({"decoder_config": {}}))
            (codec / "model.safetensors").write_bytes(b"codec")
            self.assertEqual(manifest_from_directory(root).speech.operations, ())
            (codec / "config.json").write_text(
                json.dumps({"decoder_config": {}, "encoder_config": {}})
            )
            model = manifest_from_directory(root, revision="pinned")
            self.assertEqual([op.mode for op in model.speech.operations], ["clone"])
            self.assertEqual(model.speech.verification, "candidate")
            restored = manifest_from_dict(model.to_dict())
            self.assertEqual(restored, model)
            self.assertGreater(model.disk_size_bytes, len(b"weights") + len(b"codec"))
            (root / "tokenizer.json").unlink()
            (root / "vocab.json").write_text("{}")
            (root / "merges.txt").write_text("#version: 0.2")
            self.assertTrue(manifest_from_directory(root).speech.operations)
            (root / "model.safetensors.index.json").write_text(
                json.dumps({"weight_map": {"a": "missing.safetensors"}})
            )
            self.assertEqual(manifest_from_directory(root).speech.operations, ())


class SpeechWorkerTests(unittest.TestCase):
    def test_writer_consumes_every_segment_and_rejects_rate_changes(self):
        class Engine:
            def segments(self, parameters, check):
                yield 24000, struct.pack("<h", 1000) * 2400
                yield 24000, struct.pack("<h", 2000) * 4800

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "all.wav"
            engine = WorkerAudioEngine("fake", "fake://audio")
            engine.adapter = Engine()
            engine._write({}, output, lambda: None)
            with wave.open(str(output)) as audio:
                self.assertEqual(audio.getnframes(), 7200)
                self.assertEqual(audio.readframes(7200)[-2:], struct.pack("<h", 2000))

            class Invalid:
                def segments(self, parameters, check):
                    yield 24000, b"\x00\x01" * 2400
                    yield 16000, b"\x00\x01" * 2400

            engine.adapter = Invalid()
            with self.assertRaisesRegex(ValueError, "AUDIO_SAMPLE_RATE_INVALID"):
                engine._write({}, output, lambda: None)

    def test_worker_rejects_path_escape_and_unknown_parameters_without_content_events(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "staging").mkdir()
            engine = WorkerAudioEngine("fake", "fake://audio")
            events = []
            with patch.dict(os.environ, {"MLX_STUDIO_AUDIO_ROOT": directory}):
                for values, output in (
                    ({"text": "private", "speed": 2}, root / "staging/out.wav"),
                    ({"text": "private", "mode": "preset"}, root / "outside.wav"),
                ):
                    engine.generate(
                        {
                            "job_id": "id",
                            "parameters": values,
                            "output_path": str(output),
                        },
                        (threading.Event(), threading.Event()),
                        lambda kind, payload: events.append((kind, payload)),
                    )
            self.assertTrue(all(kind == "generation.failed" for kind, _ in events))
            self.assertNotIn("private", json.dumps(events))
            self.assertFalse((root / "outside.wav").exists())
