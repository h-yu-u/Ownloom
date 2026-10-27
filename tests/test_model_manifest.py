import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from mlx_studio_runtime.adapters.model_scan import manifest_from_directory

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "runtime" / "src"))

from mlx_studio_runtime.domain.models import infer_model_kind


class ModelManifestTests(unittest.TestCase):
    def test_complete_qwen21_export_advertises_editing_from_vision_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "model_index.json").write_text(
                json.dumps({"_class_name": "QwenImage21Pipeline"})
            )
            for name in ["transformer", "vae", "text_encoder", "processor"]:
                (root / name).mkdir()
            for name in ["transformer", "vae", "text_encoder"]:
                (root / name / "config.json").write_text(
                    json.dumps(
                        {"vision_config": {}}
                        if name == "text_encoder"
                        else {"type": name}
                    )
                )
            (root / "text_encoder/model.safetensors.index.json").write_text(
                json.dumps(
                    {"weight_map": {"visual.patch_embed.proj.weight": "0.safetensors"}}
                )
            )
            (root / "processor/preprocessor_config.json").write_text("{}")
            manifest = manifest_from_directory(root)
            self.assertTrue(manifest.capabilities.image_editing)
            self.assertTrue(manifest.capabilities.multi_image)
            self.assertTrue(manifest.capabilities.inpainting)
            self.assertIn("image", manifest.input_modalities)
            (root / "text_encoder/config.json").write_text("{}")
            self.assertFalse(manifest_from_directory(root).capabilities.image_editing)

    def test_native_mflux_qwen21_export_is_recognized_without_root_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "arbitrary-directory-name"
            signatures = {
                "transformer": [
                    "modulation.layers.1.weight",
                    "transformer_blocks.31.attn.to_q.weight",
                    "transformer_blocks.31.img_mlp.gate_layer.weight",
                ],
                "text_encoder": ["layers.35.self_attn.q_norm.weight"],
                "vae": ["decoder.conv_out.conv.weight"],
            }
            for name, keys in signatures.items():
                component = root / name
                component.mkdir(parents=True)
                (component / "0.safetensors").write_bytes(b"weights")
                (component / "model.safetensors.index.json").write_text(
                    json.dumps(
                        {
                            "metadata": {"mflux_version": "0.20.0"},
                            "weight_map": dict.fromkeys(keys, "0.safetensors"),
                        }
                    )
                )
            (root / "processor").mkdir()
            for name in ("tokenizer.json", "tokenizer_config.json"):
                (root / "processor" / name).write_text("{}")
            model = manifest_from_directory(root)
            self.assertEqual((model.engine, model.task), ("mflux", "image-generation"))
            self.assertEqual(model.output_modalities, ("image",))
            (root / "vae" / "0.safetensors").unlink()
            with self.assertRaisesRegex(ValueError, "MODEL_WEIGHTS_INCOMPLETE"):
                manifest_from_directory(root)
            index = root / "transformer" / "model.safetensors.index.json"
            value = json.loads(index.read_text())
            value["weight_map"]["modulation.layers.1.weight"] = "../outside.safetensors"
            index.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, "MODEL_METADATA_INVALID"):
                manifest_from_directory(root)

    def test_qwen_multimodal_manifest_reads_nested_text_context(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "Qwen3.8-27B-Uncensored-MLX" / "4-bit"
            root.mkdir(parents=True)
            (root / "config.json").write_text(
                json.dumps(
                    {
                        "model_type": "qwen3_5",
                        "architectures": ["Qwen3_5ForConditionalGeneration"],
                        "vision_config": {},
                        "text_config": {"max_position_embeddings": 262144},
                    }
                )
            )
            model = manifest_from_directory(root)
            self.assertEqual(model.engine, "mlx-vlm")
            self.assertEqual(model.context_length, 262144)
            self.assertIn("text", model.output_modalities)
            self.assertEqual(model.display_name, "Qwen3.8-27B-Uncensored-MLX · 4-bit")

    def test_installation_identity_is_distinct_when_directory_moves(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first"
            second = Path(directory) / "second"
            first.mkdir()
            (first / "config.json").write_text(
                json.dumps(
                    {
                        "model_type": "llama",
                        "max_position_embeddings": 4096,
                        "_name_or_path": str(first),
                    }
                ),
                encoding="utf-8",
            )
            (first / "model.safetensors").write_bytes(b"weights")
            original = manifest_from_directory(first)
            shutil.move(first, second)
            (second / "config.json").write_text(
                json.dumps(
                    {
                        "model_type": "llama",
                        "max_position_embeddings": 4096,
                        "_name_or_path": str(second),
                    }
                ),
                encoding="utf-8",
            )
            moved = manifest_from_directory(second)
            self.assertNotEqual(original.id, moved.id)
            self.assertEqual(original.artifact_identity, moved.artifact_identity)
            self.assertNotEqual(original.local_path, moved.local_path)

    def test_stablelm_is_not_misclassified_as_an_image_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "stablelm"
            root.mkdir()
            (root / "config.json").write_text(
                json.dumps(
                    {"model_type": "stablelm", "architectures": ["StableLmForCausalLM"]}
                ),
                encoding="utf-8",
            )
            (root / "weights.safetensors").write_bytes(b"weights")
            self.assertEqual(manifest_from_directory(root).engine, "mlx-lm")

    def test_missing_or_malformed_architectures_do_not_break_metadata_scan(
        self,
    ) -> None:
        for value in (None, 42, "Qwen2ForCausalLM", {"unexpected": "object"}):
            with self.subTest(architectures=value):
                self.assertEqual(
                    infer_model_kind(
                        {"model_type": "qwen2", "architectures": value}, {}
                    ),
                    ("mlx-lm", "text-generation"),
                )

    def test_qwen_image_pipeline_is_an_image_model(self) -> None:
        self.assertEqual(
            infer_model_kind({}, {"_class_name": "QwenImagePipeline"}),
            ("mflux", "image-generation"),
        )

    def test_static_metadata_distinguishes_vlm_and_image_generation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            vlm = root / "vlm"
            vlm.mkdir()
            (vlm / "config.json").write_text(
                json.dumps({"model_type": "qwen2_vl", "architectures": ["Qwen2VL"]}),
                encoding="utf-8",
            )
            image = root / "image"
            image.mkdir()
            (image / "model_index.json").write_text(
                json.dumps({"_class_name": "FluxPipeline"}),
                encoding="utf-8",
            )
            self.assertEqual(manifest_from_directory(vlm).engine, "mlx-vlm")
            self.assertEqual(manifest_from_directory(image).engine, "mflux")


if __name__ == "__main__":
    unittest.main()
