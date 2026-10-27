#!/usr/bin/env python3
"""Generate and validate one PNG through the MFLUX Python API."""

from __future__ import annotations

import argparse
import platform
import sys
import tempfile
import time
from pathlib import Path


DEFAULT_MODEL = "filipstrand/Z-Image-Turbo-mflux-4bit"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--prompt", default="A red apple on a wooden table, soft studio light")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--steps", type=int, default=9)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        print("This spike requires Apple Silicon macOS.", file=sys.stderr)
        return 2
    if args.width % 16 or args.height % 16 or not 1 <= args.steps <= 100:
        print("Width and height must be divisible by 16; steps must be from 1 to 100.", file=sys.stderr)
        return 2

    try:
        from mflux.models.common.config import ModelConfig
        from mflux.models.z_image import ZImageTurbo

        started = time.perf_counter()
        model = ZImageTurbo(
            model_config=ModelConfig.z_image_turbo(),
            model_path=args.model,
        )
        image = model.generate_image(
            seed=args.seed,
            prompt=args.prompt,
            num_inference_steps=args.steps,
            width=args.width,
            height=args.height,
        )
        if args.output:
            output_path = args.output.expanduser().resolve()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            image.save(output_path)
            _validate_png(output_path, args.width, args.height)
        else:
            with tempfile.TemporaryDirectory(prefix="mlx-studio-mflux-") as directory:
                output_path = Path(directory) / "result.png"
                image.save(output_path)
                _validate_png(output_path, args.width, args.height)
        print(
            f"P0-04 passed: model={args.model} width={args.width} height={args.height} "
            f"elapsed_seconds={time.perf_counter() - started:.2f}",
            file=sys.stderr,
        )
    except Exception as error:  # Process boundary for the feasibility spike.
        print(f"P0-04 failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


def _validate_png(path: Path, width: int, height: int) -> None:
    with path.open("rb") as image_file:
        header = image_file.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or len(header) < 24:
        raise RuntimeError("Generated output is not a valid PNG")
    actual_width = int.from_bytes(header[16:20], "big")
    actual_height = int.from_bytes(header[20:24], "big")
    if (actual_width, actual_height) != (width, height):
        raise RuntimeError("Generated image dimensions do not match the request")


if __name__ == "__main__":
    raise SystemExit(main())
