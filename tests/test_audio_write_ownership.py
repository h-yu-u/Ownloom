"""Cancelling an upload cannot release its write lease before the file writer stops."""

import asyncio
import io
import tempfile
import threading
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from mlx_studio_runtime.adapters.audio_files import AudioFiles
from mlx_studio_runtime.application.data_admission import DataAdmission
from mlx_studio_runtime.entrypoints.http.data_admission import DataAdmissionMiddleware


class AudioWriteOwnershipTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_upload_drains_file_write_before_backup_and_removes_staging(
        self,
    ):
        content = io.BytesIO()
        with wave.open(content, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(8000)
            audio.writeframes(b"\x00\x10" * 8000)
        with tempfile.TemporaryDirectory() as directory:
            files = AudioFiles(Path(directory))
            admission = DataAdmission()
            entered, release, finished = (
                threading.Event(),
                threading.Event(),
                threading.Event(),
            )
            original = Path.write_bytes

            def write(path, data):
                entered.set()
                try:
                    if not release.wait(10):
                        raise TimeoutError("test did not release audio writer")
                    return original(path, data)
                finally:
                    finished.set()

            async def application(scope, receive, send):
                await files.upload(content.getvalue(), "fixture")

            async def snapshot():
                async with admission.exclusive():
                    self.assertTrue(
                        finished.is_set(), "snapshot overlapped the cancelled writer"
                    )

            middleware = DataAdmissionMiddleware(application, admission)
            with patch.object(Path, "write_bytes", write):
                upload = asyncio.create_task(
                    middleware(
                        {
                            "type": "http",
                            "method": "POST",
                            "path": "/internal/v1/audio-assets",
                        },
                        None,
                        None,
                    )
                )
                backup = None
                try:
                    async with asyncio.timeout(5):
                        while not entered.is_set():
                            await asyncio.sleep(0.001)
                    upload.cancel()
                    await asyncio.sleep(0)
                    upload.cancel()
                    await asyncio.sleep(0)
                    backup = asyncio.create_task(snapshot())
                    async with asyncio.timeout(5):
                        while not admission.closed and not backup.done():
                            await asyncio.sleep(0)
                    self.assertFalse(upload.done())
                    self.assertFalse(backup.done())
                finally:
                    release.set()
                    results = await asyncio.gather(
                        upload, *([backup] if backup else []), return_exceptions=True
                    )
                    async with asyncio.timeout(5):
                        while not finished.is_set():
                            await asyncio.sleep(0.001)
                self.assertIsInstance(results[0], asyncio.CancelledError)
                self.assertIsNone(results[1])
                self.assertFalse(files.temporary("fixture").exists())
                self.assertFalse(
                    (Path(directory) / "audio/references/fixture.wav").exists()
                )
