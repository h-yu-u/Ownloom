#!/usr/bin/env python3
"""Run a small MLX text model and report streaming generation metrics."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
import sys
import time
from collections.abc import Iterator


DEFAULT_MODEL = "mlx-community/Qwen2.5-0.5B-Instruct-4bit"
DEFAULT_REVISION = "53a32aee5e9447773fd2b85988395066aef3700a"
DEFAULT_PROMPT = "请用中文介绍苹果芯片统一内存对本地大语言模型推理的帮助。"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--max-tokens", type=int, default=128)
    return parser.parse_args()


def stream_response(
    model: object,
    tokenizer: object,
    prompt: str,
    max_tokens: int,
) -> dict[str, int | float | str | None]:
    from mlx_lm import stream_generate

    start = time.perf_counter()
    first_token_ms: float | None = None
    first_text_ms: float | None = None
    event_count = 0
    generated_text = ""
    final_response = None
    responses: Iterator[object] = stream_generate(
        model,
        tokenizer,
        prompt,
        max_tokens=max_tokens,
        temp=0.0,
    )
    for response in responses:
        event_count += 1
        elapsed_ms = (time.perf_counter() - start) * 1000
        if first_token_ms is None:
            first_token_ms = elapsed_ms
        text = response.text
        if text:
            if first_text_ms is None:
                first_text_ms = elapsed_ms
            generated_text += text
            print(text, end="", flush=True)
        final_response = response
    print(flush=True)

    if final_response is None or not generated_text.strip():
        raise RuntimeError("mlx-lm returned no generated text")
    return {
        "stream_events": event_count,
        "generated_tokens": final_response.generation_tokens,
        "first_token_ms": round(first_token_ms, 2) if first_token_ms is not None else None,
        "first_text_ms": round(first_text_ms, 2) if first_text_ms is not None else None,
        "generation_tokens_per_second": round(final_response.generation_tps, 2),
        "peak_memory_gb": round(final_response.peak_memory, 3),
        "finish_reason": final_response.finish_reason,
        "output_non_empty": bool(generated_text.strip()),
    }


def main() -> int:
    args = parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        print("This spike requires Apple Silicon macOS.", file=sys.stderr)
        return 2

    try:
        from mlx_lm import load

        print(f"Loading {args.model} at {args.revision}…", file=sys.stderr, flush=True)
        model, tokenizer = load(
            args.model,
            revision=args.revision,
            trust_remote_code=False,
        )
        rendered_prompt = tokenizer.apply_chat_template(
            [{"role": "user", "content": args.prompt}],
            tokenize=False,
            add_generation_prompt=True,
        )
        metrics = stream_response(model, tokenizer, rendered_prompt, args.max_tokens)
        summary = {
            "status": "passed",
            "model": args.model,
            "revision": args.revision,
            "mlx_lm_version": importlib.metadata.version("mlx-lm"),
            "python_version": platform.python_version(),
            **metrics,
        }
        print(json.dumps(summary, ensure_ascii=False), file=sys.stderr)
    except Exception as error:  # Process boundary: report a concise spike failure.
        print(f"P0-02 failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
