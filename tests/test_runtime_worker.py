import asyncio
import io
import json
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

RUNTIME_SOURCE = Path(__file__).parents[1] / "services" / "runtime" / "src"
sys.path.insert(0, str(RUNTIME_SOURCE))

from mlx_studio_runtime.adapters.text_engines.session import EngineSession
from mlx_studio_runtime.adapters.worker_host import WorkerHost
from mlx_studio_runtime.domain.models import fake_text_manifest
from mlx_studio_runtime.entrypoints.worker.main import Worker


class WorkerHostTests(unittest.TestCase):
    def test_text_prompt_uses_sampler_and_persisted_history(self) -> None:
        worker = EngineSession()
        captured_messages: list[dict[str, str]] = []
        captured_sampler: list[object] = []

        class FakeTokenizer:
            def encode(self, text):
                return list(text.encode())

            def apply_chat_template(self, messages, **_kwargs):
                captured_messages.extend(messages)
                return "rendered prompt"

        worker.tokenizer = FakeTokenizer()
        worker.model = object()
        fake_library = ModuleType("mlx_lm")
        fake_library.__path__ = []

        def stream_generate(*_args, **kwargs):
            captured_sampler.append(kwargs["sampler"])
            return iter([SimpleNamespace(text="answer")])

        fake_library.stream_generate = stream_generate
        sample_utils = ModuleType("mlx_lm.sample_utils")
        sample_utils.make_sampler = lambda temp: {"temperature": temp}
        messages = [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
            {"role": "user", "content": "follow-up"},
        ]
        with patch.dict(
            sys.modules,
            {"mlx_lm": fake_library, "mlx_lm.sample_utils": sample_utils},
        ):
            chunks = list(worker._mlx_chunks("follow-up", 16, 0.2, messages))

        self.assertEqual(
            [message["content"] for message in captured_messages],
            ["first question", "first answer", "follow-up"],
        )
        self.assertEqual(captured_sampler, [{"temperature": 0.2}])
        self.assertEqual(chunks, ["answer"])

    def test_vlm_uses_streaming_api(self) -> None:
        worker = EngineSession()
        worker.model = object()
        worker.processor = SimpleNamespace(
            tokenizer=SimpleNamespace(encode=lambda text: list(text.encode()))
        )
        worker.model_config = object()
        fake_library = ModuleType("mlx_vlm")
        fake_library.__path__ = []
        fake_library.stream_generate = lambda **_kwargs: iter(
            [SimpleNamespace(text="image "), SimpleNamespace(text="answer")]
        )
        prompt_utils = ModuleType("mlx_vlm.prompt_utils")
        prompt_utils.apply_chat_template = lambda *_args, **_kwargs: "formatted"
        with patch.dict(
            sys.modules,
            {"mlx_vlm": fake_library, "mlx_vlm.prompt_utils": prompt_utils},
        ):
            chunks = list(worker._vlm_chunks("describe", 16, 0.0, ["image.png"]))
        self.assertEqual(chunks, ["image ", "answer"])

    def test_vlm_keeps_history_and_disables_thinking_for_chat(self) -> None:
        worker = EngineSession()
        worker.engine = "mlx-vlm"
        worker.model = object()
        worker.processor = SimpleNamespace(
            tokenizer=SimpleNamespace(encode=lambda text: list(text.encode()))
        )
        worker.model_config = object()
        history = [
            {"role": "user", "content": "记住暗号蓝鲸"},
            {"role": "assistant", "content": "已记住"},
            {"role": "user", "content": "暗号是什么？"},
        ]
        library = ModuleType("mlx_vlm")
        library.__path__ = []
        library.stream_generate = Mock(
            return_value=iter([SimpleNamespace(text="蓝鲸")])
        )
        templates = ModuleType("mlx_vlm.prompt_utils")
        templates.apply_chat_template = Mock(return_value="history prompt")
        with patch.dict(
            sys.modules, {"mlx_vlm": library, "mlx_vlm.prompt_utils": templates}
        ):
            chunks = list(
                worker._chunks({"messages": history}, "暗号是什么？", 32, 0.0)
            )
        self.assertEqual(chunks, ["蓝鲸"])
        self.assertEqual(templates.apply_chat_template.call_args.args[2], history)
        self.assertFalse(
            templates.apply_chat_template.call_args.kwargs["enable_thinking"]
        )
        self.assertEqual(library.stream_generate.call_args.kwargs["image"], [])

    def test_vlm_load_preserves_protocol_and_configures_clean_shutdown(self) -> None:
        worker = Worker()
        worker.protocol_output = io.StringIO()
        mlx = ModuleType("mlx")
        mlx.__path__ = []
        core = ModuleType("mlx.core")
        core.disable_compile = Mock()
        core.set_cache_limit = Mock()
        core.synchronize = Mock()
        core.clear_cache = Mock()
        mlx.core = core
        library = ModuleType("mlx_vlm")
        library.__path__ = []

        def load(path, **kwargs):
            core.disable_compile.assert_called_once()
            self.assertFalse(kwargs["trust_remote_code"])
            print("upstream loading progress")
            return object(), object()

        library.load = load
        utils = ModuleType("mlx_vlm.utils")
        utils.load_config = lambda _path: {"model_type": "qwen3_5"}
        with patch.dict(
            sys.modules,
            {
                "mlx": mlx,
                "mlx.core": core,
                "mlx_vlm": library,
                "mlx_vlm.utils": utils,
            },
        ):
            worker.handle(
                {
                    "type": "worker.load",
                    "payload": {
                        "manifest": {
                            "id": "local-qwen",
                            "engine": "mlx-vlm",
                            "localPath": "/local/model",
                            "task": "vision-language",
                        }
                    },
                }
            )
            worker.unload()
        events = [
            json.loads(line) for line in worker.protocol_output.getvalue().splitlines()
        ]
        self.assertEqual(
            [item["type"] for item in events], ["model.loading", "model.loaded"]
        )
        core.synchronize.assert_called_once()
        core.clear_cache.assert_called_once()

    def test_fake_worker_load_stream_cancel_and_restart(self) -> None:
        asyncio.run(self._exercise_worker())

    async def _exercise_worker(self) -> None:
        host = WorkerHost(RUNTIME_SOURCE)
        manifest = fake_text_manifest().to_dict()
        await host.load(manifest)
        stream = host.generate("job-1", "stream me", 100, 0.5)
        first = await anext(stream)
        self.assertEqual(first["type"], "generation.started")
        await host.cancel("job-1")
        remaining = [event async for event in stream]
        self.assertEqual(remaining[-1]["type"], "generation.cancelled")

        await host.stop()
        await host.start()
        await host.load(manifest)
        events = [event async for event in host.generate("job-2", "hello", 20, 0.0)]
        self.assertEqual(events[-1]["type"], "generation.completed")
        self.assertTrue(any(event["type"] == "generation.delta" for event in events))
        await host.stop()

    def test_repeated_worker_start_and_stop_is_idempotent(self) -> None:
        asyncio.run(self._exercise_repeated_worker_lifecycle())

    async def _exercise_repeated_worker_lifecycle(self) -> None:
        manifest = fake_text_manifest().to_dict()
        for cycle in range(10):
            host = WorkerHost(RUNTIME_SOURCE)
            await host.load(manifest)
            events = [
                event async for event in host.generate(f"job-{cycle}", "cycle", 16, 0.0)
            ]
            self.assertEqual(events[-1]["type"], "generation.completed")
            process = host.process
            self.assertIsNotNone(process)
            await host.stop()
            self.assertEqual(process.returncode, 0)
            self.assertIsNone(host.process)


if __name__ == "__main__":
    unittest.main()
