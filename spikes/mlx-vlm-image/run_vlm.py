#!/usr/bin/env python3
"""Run one image-understanding request through the mlx-vlm Python API."""

from __future__ import annotations

import argparse
import importlib.metadata
import platform
import sys
import time
from pathlib import Path


DEFAULT_MODEL = "mlx-community/Qwen2-VL-2B-Instruct-4bit"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--prompt", default="Describe this image.")
    parser.add_argument("--max-tokens", type=int, default=128)
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        print("This spike requires Apple Silicon macOS.", file=sys.stderr)
        return 2
    if not args.image.is_file() or args.image.stat().st_size > 50 * 1024 * 1024:
        print("Image is missing or exceeds the 50 MB spike limit.", file=sys.stderr)
        return 2

    try:
        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.utils import load_config

        started = time.perf_counter()
        model, processor = load(args.model, trust_remote_code=False)
        config = load_config(args.model)
        prompt = apply_chat_template(
            processor, config, args.prompt, num_images=1, add_generation_prompt=True
        )
        result = generate(
            model=model,
            processor=processor,
            prompt=prompt,
            image=[str(args.image.resolve())],
            max_tokens=args.max_tokens,
            temperature=0.0,
            verbose=False,
        )
        text = result if isinstance(result, str) else getattr(result, "text", str(result))
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("mlx-vlm returned no image description")
        print(text)
        print(
            f"P0-03 passed: model={args.model} mlx_vlm={importlib.metadata.version('mlx-vlm')} "
            f"elapsed_seconds={time.perf_counter() - started:.2f}",
            file=sys.stderr,
        )
    except Exception as error:  # Process boundary for the feasibility spike.
        print(f"P0-03 failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
